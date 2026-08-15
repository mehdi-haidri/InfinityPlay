package com.infinityplay.app;

import android.content.Intent;
import android.net.Uri;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Offline downloads for Android.
 *
 * Backed by {@link FileDownloader} rather than the system DownloadManager, which could neither send
 * the User-Agent the stream CDN insists on nor pause a transfer.
 */
@CapacitorPlugin(name = "InfinityDownloads")
public class DownloadsPlugin extends Plugin {

    private FileDownloader downloader;

    private FileDownloader downloader() {
        if (downloader == null) downloader = new FileDownloader(getContext());
        return downloader;
    }

    @PluginMethod
    public void start(PluginCall call) {
        String url = call.getString("url");
        String title = call.getString("title", "InfinityPlay video");
        if (url == null || !(url.startsWith("http://") || url.startsWith("https://"))) {
            call.reject("Only HTTP and HTTPS video downloads are supported on Android.");
            return;
        }
        try {
            JSObject result = new JSObject();
            result.put("id", downloader().start(url, title));
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Could not start the download.", error);
        }
    }

    @PluginMethod
    public void status(PluginCall call) {
        String id = call.getString("id");
        if (id == null) { call.reject("Missing download id."); return; }

        FileDownloader.Job job = downloader().status(id);
        if (job == null) { call.reject("Download not found."); return; }

        JSObject result = new JSObject();
        result.put("state", job.state);
        result.put("receivedBytes", job.received.get());
        result.put("totalBytes", job.total.get());
        result.put("fileUrl", "completed".equals(job.state) ? Uri.fromFile(job.file).toString() : "");
        result.put("failureReason", job.failureReason);
        call.resolve(result);
    }

    @PluginMethod
    public void pause(PluginCall call) {
        String id = call.getString("id");
        if (id == null) { call.reject("Missing download id."); return; }
        JSObject result = new JSObject();
        result.put("ok", downloader().pause(id));
        call.resolve(result);
    }

    @PluginMethod
    public void resume(PluginCall call) {
        String id = call.getString("id");
        if (id == null) { call.reject("Missing download id."); return; }
        JSObject result = new JSObject();
        result.put("ok", downloader().resume(id));
        call.resolve(result);
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        String id = call.getString("id");
        if (id == null) { call.reject("Missing download id."); return; }
        downloader().cancel(id);
        call.resolve();
    }

    @PluginMethod
    public void open(PluginCall call) {
        String id = call.getString("id");
        if (id == null) { call.reject("Missing download id."); return; }

        FileDownloader.Job job = downloader().status(id);
        if (job == null || !job.file.exists()) { call.reject("Downloaded file is unavailable."); return; }

        try {
            // Another app cannot read a `file://` path on modern Android; it needs a content URI.
            Uri uri = FileProvider.getUriForFile(
                getContext(),
                getContext().getPackageName() + ".fileprovider",
                job.file);
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, "video/*");
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception error) {
            call.reject("No Android app can open this video.", error);
        }
    }
}
