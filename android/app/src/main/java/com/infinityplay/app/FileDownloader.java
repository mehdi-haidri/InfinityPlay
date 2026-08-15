package com.infinityplay.app;

import android.content.Context;
import android.os.Environment;

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
 * Resumable HTTP downloads.
 *
 * Android's DownloadManager was doing this job and could not: it sends its own User-Agent, and the
 * stream CDN answers 428 to anything that is not this app, so a download either failed outright or
 * saved an error page. It also has no pause — the API exposes a paused *state* but no way to ask
 * for one — which is why the downloads screen hid those controls on Android.
 *
 * This does the fetching itself: the app's own User-Agent, a `Range` header to pick up where a
 * paused file stopped, and a flag the UI can set to stop and restart a transfer.
 *
 * Scope worth knowing: transfers run on their own threads inside the app process. Backgrounding
 * the app is fine; the system killing the process is not, and an interrupted file resumes from its
 * partial bytes the next time it is started.
 */
final class FileDownloader {

    /** Matches the desktop app. The CDN refuses browser-looking clients with 428. */
    private static final String STREAM_USER_AGENT =
        "com.community.oneroom/50020042 (Linux; U; Android 13; en_US; 2201117TY; "
            + "Build/TQ2A.230405.003; Cronet/135.0.7012.3)";

    private static final int BUFFER = 128 * 1024;
    private static final int MAX_REDIRECTS = 5;

    /** What the UI polls for. Mirrors the fields the TypeScript `DownloadRecord` expects. */
    static final class Job {
        final String id;
        final String url;
        final File file;
        volatile String state = "progressing";
        volatile String failureReason = "";
        final AtomicLong received = new AtomicLong();
        final AtomicLong total = new AtomicLong();
        volatile boolean pauseRequested;
        volatile boolean cancelRequested;
        Thread worker;

        Job(String id, String url, File file) {
            this.id = id;
            this.url = url;
            this.file = file;
        }
    }

    private final Map<String, Job> jobs = new ConcurrentHashMap<>();
    private final Context context;

    FileDownloader(Context context) {
        this.context = context.getApplicationContext();
    }

    private static String safeName(String value) {
        String cleaned = value.replaceAll("[\\\\/:*?\"<>|]", "_").trim();
        if (cleaned.isEmpty()) cleaned = "InfinityPlay-video";
        if (!cleaned.toLowerCase(Locale.ROOT).matches(".*\\.(mp4|mkv|webm|mov)$")) cleaned += ".mp4";
        return cleaned;
    }

    /** Begins a download and returns its id. */
    String start(String url, String title) throws IOException {
        File directory = context.getExternalFilesDir(Environment.DIRECTORY_MOVIES);
        if (directory == null) throw new IOException("This device has no available storage for downloads.");
        if (!directory.exists() && !directory.mkdirs()) throw new IOException("Could not create the downloads folder.");

        String id = "dl-" + System.currentTimeMillis() + "-" + Math.abs(url.hashCode());
        Job job = new Job(id, url, new File(directory, safeName(title)));
        jobs.put(id, job);
        run(job);
        return id;
    }

    /** Stops the transfer but keeps the partial file, so resuming continues from there. */
    boolean pause(String id) {
        Job job = jobs.get(id);
        if (job == null || !"progressing".equals(job.state)) return false;
        job.pauseRequested = true;
        return true;
    }

    boolean resume(String id) {
        Job job = jobs.get(id);
        if (job == null || !"paused".equals(job.state)) return false;
        job.pauseRequested = false;
        job.state = "progressing";
        run(job);
        return true;
    }

    void cancel(String id) {
        Job job = jobs.remove(id);
        if (job == null) return;
        job.cancelRequested = true;
        if (job.worker != null) job.worker.interrupt();
        // The partial file is of no use once the user has given up on it.
        if (job.file.exists() && !job.file.delete()) job.file.deleteOnExit();
    }

    Job status(String id) {
        return jobs.get(id);
    }

    private void run(Job job) {
        Thread worker = new Thread(() -> transfer(job), "infinityplay-download");
        job.worker = worker;
        worker.start();
    }

    private void transfer(Job job) {
        HttpURLConnection connection = null;
        try {
            long offset = job.file.exists() ? job.file.length() : 0;
            job.received.set(offset);

            connection = open(job.url, offset, 0);
            int status = connection.getResponseCode();

            // 416 means the file on disk is already the whole thing.
            if (status == 416 && offset > 0) {
                job.total.set(offset);
                job.state = "completed";
                return;
            }
            if (status != 200 && status != 206) {
                job.state = "interrupted";
                job.failureReason = "The server refused the download (HTTP " + status + ").";
                return;
            }

            // A 200 to a ranged request means the server ignored the range and is sending the whole
            // file, so anything already on disk has to be thrown away rather than appended to.
            boolean append = status == 206 && offset > 0;
            if (!append) {
                offset = 0;
                job.received.set(0);
            }

            long length = connection.getContentLengthLong();
            job.total.set(length > 0 ? length + (append ? offset : 0) : 0);

            try (InputStream in = connection.getInputStream();
                 FileOutputStream out = new FileOutputStream(job.file, append)) {
                byte[] buffer = new byte[BUFFER];
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
            job.failureReason = error.getMessage() == null ? "The download stopped unexpectedly." : error.getMessage();
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private HttpURLConnection open(String target, long offset, int hop) throws IOException {
        if (hop > MAX_REDIRECTS) throw new IOException("Too many redirects.");

        HttpURLConnection connection = (HttpURLConnection) new URL(target).openConnection();
        // Followed here rather than by the client, so the substitute User-Agent survives each hop.
        connection.setInstanceFollowRedirects(false);
        connection.setRequestProperty("User-Agent", STREAM_USER_AGENT);
        connection.setRequestProperty("Accept", "*/*");
        if (offset > 0) connection.setRequestProperty("Range", "bytes=" + offset + "-");
        connection.setConnectTimeout(20000);
        connection.setReadTimeout(60000);

        int status = connection.getResponseCode();
        if (status >= 300 && status < 400) {
            String location = connection.getHeaderField("Location");
            connection.disconnect();
            if (location == null) throw new IOException("The download address could not be followed.");
            return open(new URL(new URL(target), location).toString(), offset, hop + 1);
        }
        return connection;
    }
}
