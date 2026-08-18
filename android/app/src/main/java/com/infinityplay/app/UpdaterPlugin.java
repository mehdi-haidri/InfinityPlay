package com.infinityplay.app;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Native in-app APK updater for Android.
 *
 * Downloads the update APK from GitHub Releases with resumable byte-range fetching,
 * tracks progress, and triggers the Android system package installer via FileProvider.
 */
@CapacitorPlugin(name = "InfinityUpdater")
public class UpdaterPlugin extends Plugin {

    private static final String APP_USER_AGENT = "InfinityPlay-Android";
    private static final int BUFFER_SIZE = 128 * 1024;
    private static final int MAX_REDIRECTS = 5;

    static final class UpdateJob {
        final String id;
        final String url;
        final String version;
        final File file;
        volatile String state = "progressing";
        volatile String failureReason = "";
        final AtomicLong received = new AtomicLong();
        final AtomicLong total = new AtomicLong();
        volatile boolean pauseRequested;
        volatile boolean cancelRequested;
        Thread worker;

        UpdateJob(String id, String url, String version, File file) {
            this.id = id;
            this.url = url;
            this.version = version;
            this.file = file;
        }
    }

    private final Map<String, UpdateJob> jobs = new ConcurrentHashMap<>();
    private volatile UpdateJob lastJob;

    private File getUpdatesDir() {
        File dir = new File(getContext().getExternalFilesDir(null), "updates");
        if (!dir.exists()) {
            dir.mkdirs();
        }
        return dir;
    }

    private static String safeApkName(String version, String filename) {
        if (filename != null && !filename.trim().isEmpty()) {
            String cleaned = filename.replaceAll("[\\\\/:*?\"<>|]", "_").trim();
            if (!cleaned.toLowerCase(Locale.ROOT).endsWith(".apk")) cleaned += ".apk";
            return cleaned;
        }
        if (version != null && !version.trim().isEmpty()) {
            String cleaned = version.replaceAll("[\\\\/:*?\"<>|]", "_").trim();
            return "InfinityPlay-" + cleaned + ".apk";
        }
        return "InfinityPlay-update.apk";
    }

    @PluginMethod
    public void start(PluginCall call) {
        String url = call.getString("url");
        String version = call.getString("version", "");
        String filename = call.getString("filename", "");

        if (url == null || !(url.startsWith("http://") || url.startsWith("https://"))) {
            call.reject("Only HTTP and HTTPS download URLs are supported.");
            return;
        }

        try {
            File dir = getUpdatesDir();
            // Clean up any older downloaded APKs in updates directory before starting a new update
            File targetFile = new File(dir, safeApkName(version, filename));
            File[] existing = dir.listFiles((d, name) -> name.toLowerCase(Locale.ROOT).endsWith(".apk"));
            if (existing != null) {
                for (File f : existing) {
                    if (!f.getAbsolutePath().equals(targetFile.getAbsolutePath())) {
                        f.delete();
                    }
                }
            }

            String id = "update-" + System.currentTimeMillis() + "-" + Math.abs(url.hashCode());
            UpdateJob job = new UpdateJob(id, url, version, targetFile);
            jobs.put(id, job);
            lastJob = job;
            run(job);

            JSObject result = new JSObject();
            result.put("id", id);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Could not start update download: " + error.getMessage(), error);
        }
    }

    @PluginMethod
    public void status(PluginCall call) {
        String id = call.getString("id");
        UpdateJob job = (id != null) ? jobs.get(id) : lastJob;

        if (job == null) {
            // Check if there is an existing completed APK in the updates folder
            File dir = getUpdatesDir();
            File[] existing = dir.listFiles((d, name) -> name.toLowerCase(Locale.ROOT).endsWith(".apk"));
            if (existing != null && existing.length > 0) {
                File newest = existing[0];
                for (File f : existing) {
                    if (f.lastModified() > newest.lastModified()) newest = f;
                }
                if (newest.length() > 0) {
                    JSObject result = new JSObject();
                    result.put("state", "completed");
                    result.put("receivedBytes", newest.length());
                    result.put("totalBytes", newest.length());
                    result.put("percent", 100);
                    result.put("filePath", newest.getAbsolutePath());
                    result.put("failureReason", "");
                    call.resolve(result);
                    return;
                }
            }

            JSObject result = new JSObject();
            result.put("state", "idle");
            result.put("receivedBytes", 0);
            result.put("totalBytes", 0);
            result.put("percent", 0);
            result.put("filePath", "");
            result.put("failureReason", "");
            call.resolve(result);
            return;
        }

        JSObject result = new JSObject();
        result.put("state", job.state);
        long received = job.received.get();
        long total = job.total.get();
        int percent = total > 0 ? (int) Math.min(100, (received * 100) / total) : 0;
        result.put("receivedBytes", received);
        result.put("totalBytes", total);
        result.put("percent", percent);
        result.put("filePath", "completed".equals(job.state) ? job.file.getAbsolutePath() : "");
        result.put("failureReason", job.failureReason);
        call.resolve(result);
    }

    @PluginMethod
    public void pause(PluginCall call) {
        String id = call.getString("id");
        UpdateJob job = (id != null) ? jobs.get(id) : lastJob;
        if (job == null || !"progressing".equals(job.state)) {
            JSObject result = new JSObject();
            result.put("ok", false);
            call.resolve(result);
            return;
        }
        job.pauseRequested = true;
        JSObject result = new JSObject();
        result.put("ok", true);
        call.resolve(result);
    }

    @PluginMethod
    public void resume(PluginCall call) {
        String id = call.getString("id");
        UpdateJob job = (id != null) ? jobs.get(id) : lastJob;
        if (job == null || !"paused".equals(job.state)) {
            JSObject result = new JSObject();
            result.put("ok", false);
            call.resolve(result);
            return;
        }
        job.pauseRequested = false;
        job.state = "progressing";
        run(job);
        JSObject result = new JSObject();
        result.put("ok", true);
        call.resolve(result);
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        String id = call.getString("id");
        UpdateJob job = (id != null) ? jobs.remove(id) : lastJob;
        if (job != null) {
            job.cancelRequested = true;
            if (job.worker != null) job.worker.interrupt();
            if (job.file.exists()) job.file.delete();
            if (job == lastJob) lastJob = null;
        }
        JSObject result = new JSObject();
        result.put("ok", true);
        call.resolve(result);
    }

    @PluginMethod
    public void install(PluginCall call) {
        String filePath = call.getString("filePath");
        File apkFile = null;
        if (filePath != null && !filePath.trim().isEmpty()) {
            apkFile = new File(filePath);
        } else if (lastJob != null && lastJob.file != null && lastJob.file.exists()) {
            apkFile = lastJob.file;
        } else {
            File dir = getUpdatesDir();
            File[] existing = dir.listFiles((d, name) -> name.toLowerCase(Locale.ROOT).endsWith(".apk"));
            if (existing != null && existing.length > 0) {
                File newest = existing[0];
                for (File f : existing) {
                    if (f.lastModified() > newest.lastModified()) newest = f;
                }
                apkFile = newest;
            }
        }

        if (apkFile == null || !apkFile.exists() || apkFile.length() == 0) {
            call.reject("Downloaded update APK is missing or empty.");
            return;
        }

        try {
            Context context = getContext();
            Uri apkUri = FileProvider.getUriForFile(
                context,
                context.getPackageName() + ".fileprovider",
                apkFile
            );

            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(apkUri, "application/vnd.android.package-archive");
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

            context.startActivity(intent);

            JSObject result = new JSObject();
            result.put("ok", true);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Could not launch package installer: " + error.getMessage(), error);
        }
    }

    private void run(UpdateJob job) {
        Thread worker = new Thread(() -> transfer(job), "infinityplay-updater");
        job.worker = worker;
        worker.start();
    }

    private void transfer(UpdateJob job) {
        HttpURLConnection connection = null;
        try {
            long offset = job.file.exists() ? job.file.length() : 0;
            job.received.set(offset);

            connection = openConnection(job.url, offset, 0);
            int status = connection.getResponseCode();

            // 416 means file on disk already has all content
            if (status == 416 && offset > 0) {
                job.total.set(offset);
                job.state = "completed";
                return;
            }

            if (status != 200 && status != 206) {
                job.state = "interrupted";
                job.failureReason = "Server refused download (HTTP " + status + ").";
                return;
            }

            boolean append = (status == 206 && offset > 0);
            if (!append) {
                offset = 0;
                job.received.set(0);
            }

            long length = connection.getContentLengthLong();
            job.total.set(length > 0 ? length + (append ? offset : 0) : 0);

            try (InputStream in = connection.getInputStream();
                 FileOutputStream out = new FileOutputStream(job.file, append)) {
                byte[] buffer = new byte[BUFFER_SIZE];
                int read;
                while ((read = in.read(buffer)) != -1) {
                    if (job.cancelRequested) return;
                    if (job.pauseRequested) {
                        out.flush();
                        job.state = "paused";
                        return;
                    }
                    out.write(buffer, 0, read);
                    job.received.addAndGet(read);
                }
                out.flush();
            }

            if (job.cancelRequested) return;
            job.total.set(job.file.length());
            job.state = "completed";
        } catch (Exception error) {
            if (job.cancelRequested || job.pauseRequested) return;
            job.state = "interrupted";
            job.failureReason = (error.getMessage() == null) ? "The update download stopped unexpectedly." : error.getMessage();
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private HttpURLConnection openConnection(String target, long offset, int hop) throws IOException {
        if (hop > MAX_REDIRECTS) throw new IOException("Too many redirects.");

        HttpURLConnection connection = (HttpURLConnection) new URL(target).openConnection();
        connection.setInstanceFollowRedirects(false);
        connection.setRequestProperty("User-Agent", APP_USER_AGENT);
        connection.setRequestProperty("Accept", "*/*");
        if (offset > 0) {
            connection.setRequestProperty("Range", "bytes=" + offset + "-");
        }
        connection.setConnectTimeout(20000);
        connection.setReadTimeout(60000);

        int status = connection.getResponseCode();
        if (status >= 300 && status < 400) {
            String location = connection.getHeaderField("Location");
            connection.disconnect();
            if (location == null) throw new IOException("The update download address could not be followed.");
            return openConnection(new URL(new URL(target), location).toString(), offset, hop + 1);
        }
        return connection;
    }
}
