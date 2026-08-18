package com.infinityplay.app;

import android.Manifest;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.JSArray;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.getcapacitor.PermissionState;

/**
 * Offline downloads for Android.
 *
 * Backed by {@link FileDownloader} rather than the system DownloadManager, which could neither send
 * the User-Agent the stream CDN insists on nor pause a transfer.
 */
@CapacitorPlugin(
    name = "InfinityDownloads",
    permissions = {
        @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
    }
)
public class DownloadsPlugin extends Plugin {

    private FileDownloader downloader;

    private FileDownloader downloader() {
        if (downloader == null) downloader = DownloadService.downloader(getContext());
        return downloader;
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && getPermissionState("notifications") != PermissionState.GRANTED
        ) {
            requestPermissionForAlias("notifications", call, "startAfterNotificationPermission");
            return;
        }
        startDownload(call);
    }

    @PermissionCallback
    private void startAfterNotificationPermission(PluginCall call) {
        if (getPermissionState("notifications") != PermissionState.GRANTED) {
            call.reject("Allow notifications to keep this download running in the background.");
            return;
        }
        startDownload(call);
    }

    @PluginMethod
    public void startSeason(PluginCall call) {
        if (
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && getPermissionState("notifications") != PermissionState.GRANTED
        ) {
            requestPermissionForAlias("notifications", call, "startSeasonAfterNotificationPermission");
            return;
        }
        startSeasonDownload(call);
    }

    @PermissionCallback
    private void startSeasonAfterNotificationPermission(PluginCall call) {
        if (getPermissionState("notifications") != PermissionState.GRANTED) {
            call.reject("Allow notifications to keep this season download running in the background.");
            return;
        }
        startSeasonDownload(call);
    }

    private void startSeasonDownload(PluginCall call) {
        String subjectId = call.getString("subjectId");
        String title = call.getString("title", "InfinityPlay series");
        JSArray episodeValues = call.getArray("episodes");
        if (subjectId == null || subjectId.isEmpty() || episodeValues == null) {
            call.reject("A series id and episode list are required.");
            return;
        }
        int[] episodes = new int[episodeValues.length()];
        for (int index = 0; index < episodeValues.length(); index++) {
            episodes[index] = episodeValues.optInt(index, 0);
        }
        int queued = DownloadService.enqueueSeason(
            getContext(),
            subjectId,
            title,
            call.getString("year", ""),
            call.getString("posterUrl", ""),
            call.getInt("season", 0),
            episodes,
            call.getInt("resolution", 0)
        );
        DownloadService.keepAlive(getContext());
        JSObject result = new JSObject();
        result.put("queued", queued);
        call.resolve(result);
    }

    @PluginMethod
    public void clearQueue(PluginCall call) {
        JSObject result = new JSObject();
        result.put("dropped", DownloadService.clearSeasonQueue());
        call.resolve(result);
    }

    @PluginMethod
    public void queueStatus(PluginCall call) {
        DownloadService.QueueStatus status = DownloadService.seasonQueueStatus();
        JSArray items = new JSArray();
        for (DownloadService.QueueItem item : status.items) {
            JSObject value = new JSObject();
            value.put("id", item.id);
            value.put("title", item.title);
            value.put("posterUrl", item.posterUrl);
            value.put("season", item.season);
            value.put("episode", item.episode);
            value.put("resolution", item.resolution);
            items.put(value);
        }
        JSObject result = new JSObject();
        result.put("items", items);
        result.put("paused", status.paused);
        call.resolve(result);
    }

    @PluginMethod
    public void pauseQueue(PluginCall call) {
        JSObject result = new JSObject();
        result.put("ok", DownloadService.pauseSeasonQueue());
        call.resolve(result);
    }

    @PluginMethod
    public void resumeQueue(PluginCall call) {
        JSObject result = new JSObject();
        result.put("ok", DownloadService.resumeSeasonQueue());
        call.resolve(result);
    }

    @PluginMethod
    public void removeQueued(PluginCall call) {
        String id = call.getString("id");
        if (id == null) { call.reject("Missing queue id."); return; }
        JSObject result = new JSObject();
        result.put("ok", DownloadService.removeSeasonQueueItem(id));
        call.resolve(result);
    }

    @PluginMethod
    public void seasonDownloads(PluginCall call) {
        JSArray downloads = new JSArray();
        for (DownloadService.SeasonDownloadSnapshot item : DownloadService.seasonDownloadSnapshots()) {
            JSObject value = new JSObject();
            value.put("id", item.id);
            value.put("url", item.url);
            value.put("resourceId", item.resourceId);
            value.put("title", item.title);
            value.put("year", item.year);
            value.put("posterUrl", item.posterUrl);
            value.put("subjectId", item.subjectId);
            value.put("season", item.season);
            value.put("episode", item.episode);
            value.put("resolution", item.resolution);
            value.put("state", item.state);
            value.put("receivedBytes", item.receivedBytes);
            value.put("totalBytes", item.totalBytes);
            value.put("fileUrl", item.fileUrl);
            value.put("failureReason", item.failureReason);
            value.put("startedAt", item.startedAt);
            value.put("completedAt", item.completedAt);
            value.put("filename", item.filename);
            downloads.put(value);
        }
        JSObject result = new JSObject();
        result.put("downloads", downloads);
        call.resolve(result);
    }

    private void startDownload(PluginCall call) {
        String url = call.getString("url");
        String title = call.getString("title", "InfinityPlay video");
        if (url == null || !(url.startsWith("http://") || url.startsWith("https://"))) {
            call.reject("Only HTTP and HTTPS video downloads are supported on Android.");
            return;
        }
        try {
            JSObject result = new JSObject();
            result.put("id", downloader().start(url, title));
            DownloadService.keepAlive(getContext());
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
