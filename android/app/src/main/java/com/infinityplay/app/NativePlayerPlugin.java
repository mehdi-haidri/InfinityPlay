package com.infinityplay.app;

import android.app.Activity;
import android.content.Intent;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "InfinityPlayer")
public class NativePlayerPlugin extends Plugin {
    @PluginMethod
    public void open(PluginCall call) {
        String url = call.getString("url");
        if (url == null || !(url.startsWith("http://") || url.startsWith("https://") || url.startsWith("file://") || url.startsWith("content://"))) {
            call.reject("The Android player needs a valid video URL.");
            return;
        }

        Intent intent = new Intent(getContext(), NativePlayerActivity.class);
        intent.putExtra(NativePlayerActivity.EXTRA_URL, url);
        intent.putExtra(NativePlayerActivity.EXTRA_TITLE, call.getString("title", "InfinityPlay"));
        intent.putExtra(NativePlayerActivity.EXTRA_POSITION_MS, Math.max(0L, call.getLong("positionMs", 0L)));
        intent.putExtra(NativePlayerActivity.EXTRA_SUBTITLES_JSON, call.getString("subtitlesJson", "[]"));
        startActivityForResult(call, intent, "playerFinished");
    }

    @ActivityCallback
    private void playerFinished(PluginCall call, androidx.activity.result.ActivityResult activityResult) {
        if (call == null) return;
        Intent data = activityResult.getData();
        JSObject result = new JSObject();
        result.put("positionMs", data == null ? 0L : data.getLongExtra(NativePlayerActivity.RESULT_POSITION_MS, 0L));
        result.put("durationMs", data == null ? 0L : data.getLongExtra(NativePlayerActivity.RESULT_DURATION_MS, 0L));
        result.put("ended", data != null && data.getBooleanExtra(NativePlayerActivity.RESULT_ENDED, false));
        result.put("error", data == null ? "" : data.getStringExtra(NativePlayerActivity.RESULT_ERROR));
        result.put("cancelled", activityResult.getResultCode() != Activity.RESULT_OK);
        call.resolve(result);
    }
}
