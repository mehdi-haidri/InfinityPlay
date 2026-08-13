package com.infinityplay.app;

import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Environment;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.Locale;

@CapacitorPlugin(name = "InfinityDownloads")
public class DownloadsPlugin extends Plugin {
    private DownloadManager manager() {
        return (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
    }

    private static String safeName(String value) {
        String cleaned = value.replaceAll("[\\\\/:*?\"<>|]", "_").trim();
        if (cleaned.isEmpty()) cleaned = "InfinityPlay-video";
        if (!cleaned.toLowerCase(Locale.ROOT).matches(".*\\.(mp4|mkv|webm|mov)$")) cleaned += ".mp4";
        return cleaned;
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
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
            request.setTitle(title);
            request.setDescription("Downloading for offline playback");
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            request.setAllowedOverMetered(true);
            request.setAllowedOverRoaming(false);
            request.setMimeType("video/mp4");
            request.setDestinationInExternalFilesDir(getContext(), Environment.DIRECTORY_MOVIES, safeName(title));
            JSObject result = new JSObject();
            result.put("id", String.valueOf(manager().enqueue(request)));
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Could not start the Android download.", error);
        }
    }

    @PluginMethod
    public void status(PluginCall call) {
        String rawId = call.getString("id");
        if (rawId == null) { call.reject("Missing download id."); return; }
        DownloadManager.Query query = new DownloadManager.Query().setFilterById(Long.parseLong(rawId));
        try (Cursor cursor = manager().query(query)) {
            if (!cursor.moveToFirst()) { call.reject("Download not found."); return; }
            int status = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
            long received = cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR));
            long total = cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES));
            String localUri = cursor.getString(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_LOCAL_URI));
            String reason = status == DownloadManager.STATUS_FAILED
                ? "Android download manager error " + cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON))
                : "";
            JSObject result = new JSObject();
            result.put("state", status == DownloadManager.STATUS_SUCCESSFUL ? "completed" : status == DownloadManager.STATUS_FAILED ? "interrupted" : status == DownloadManager.STATUS_PAUSED ? "paused" : "progressing");
            result.put("receivedBytes", Math.max(0, received));
            result.put("totalBytes", Math.max(0, total));
            result.put("fileUrl", localUri == null ? "" : localUri);
            result.put("failureReason", reason);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Could not read Android download status.", error);
        }
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        String rawId = call.getString("id");
        if (rawId == null) { call.reject("Missing download id."); return; }
        manager().remove(Long.parseLong(rawId));
        call.resolve();
    }

    @PluginMethod
    public void open(PluginCall call) {
        String rawId = call.getString("id");
        if (rawId == null) { call.reject("Missing download id."); return; }
        Uri uri = manager().getUriForDownloadedFile(Long.parseLong(rawId));
        if (uri == null) { call.reject("Downloaded file is unavailable."); return; }
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(uri, "video/*");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception error) {
            call.reject("No Android app can open this video.", error);
        }
    }
}
