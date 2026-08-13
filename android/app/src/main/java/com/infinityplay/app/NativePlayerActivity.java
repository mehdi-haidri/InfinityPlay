package com.infinityplay.app;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;

import androidx.annotation.Nullable;
import androidx.annotation.OptIn;
import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AppCompatActivity;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.ui.PlayerView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/** Full-screen Android player used for on-demand Movies and Series. */
@OptIn(markerClass = UnstableApi.class)
public class NativePlayerActivity extends AppCompatActivity {
    public static final String EXTRA_URL = "url";
    public static final String EXTRA_TITLE = "title";
    public static final String EXTRA_POSITION_MS = "positionMs";
    public static final String EXTRA_SUBTITLES_JSON = "subtitlesJson";
    public static final String RESULT_POSITION_MS = "positionMs";
    public static final String RESULT_DURATION_MS = "durationMs";
    public static final String RESULT_ENDED = "ended";
    public static final String RESULT_ERROR = "error";

    private PlayerView playerView;
    private ExoPlayer player;
    private long startPositionMs;
    private boolean ended;
    private String playbackError = "";

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        enterImmersiveMode();

        playerView = new PlayerView(this);
        playerView.setBackgroundColor(Color.BLACK);
        playerView.setUseController(true);
        playerView.setControllerAutoShow(true);
        playerView.setControllerHideOnTouch(true);
        playerView.setShowBuffering(PlayerView.SHOW_BUFFERING_WHEN_PLAYING);
        playerView.setShowSubtitleButton(true);
        playerView.setShowNextButton(false);
        playerView.setShowPreviousButton(false);
        playerView.setContentDescription(getIntent().getStringExtra(EXTRA_TITLE));
        setContentView(playerView);

        startPositionMs = getIntent().getLongExtra(EXTRA_POSITION_MS, 0L);
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                finishWithResult(true);
                finish();
            }
        });
    }

    private void enterImmersiveMode() {
        getWindow().getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                | View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
        );
    }

    private MediaItem createMediaItem() {
        String url = getIntent().getStringExtra(EXTRA_URL);
        MediaItem.Builder builder = new MediaItem.Builder().setUri(Uri.parse(url));
        String path = Uri.parse(url).getPath();
        if (path != null && path.toLowerCase().endsWith(".mpd")) builder.setMimeType(MimeTypes.APPLICATION_MPD);
        else if (path != null && path.toLowerCase().endsWith(".m3u8")) builder.setMimeType(MimeTypes.APPLICATION_M3U8);

        List<MediaItem.SubtitleConfiguration> subtitleConfigurations = new ArrayList<>();
        try {
            JSONArray subtitles = new JSONArray(getIntent().getStringExtra(EXTRA_SUBTITLES_JSON));
            for (int index = 0; index < subtitles.length(); index++) {
                JSONObject subtitle = subtitles.getJSONObject(index);
                String subtitleUrl = subtitle.optString("url", "");
                if (subtitleUrl.isEmpty()) continue;
                String lower = Uri.parse(subtitleUrl).getPath();
                String mime = lower != null && lower.toLowerCase().endsWith(".vtt")
                    ? MimeTypes.TEXT_VTT
                    : MimeTypes.APPLICATION_SUBRIP;
                subtitleConfigurations.add(
                    new MediaItem.SubtitleConfiguration.Builder(Uri.parse(subtitleUrl))
                        .setMimeType(mime)
                        .setLanguage(subtitle.optString("lang", "und"))
                        .setLabel(subtitle.optString("name", "Subtitle"))
                        .setSelectionFlags(0)
                        .build()
                );
            }
        } catch (Exception ignored) {
            // A malformed optional subtitle must never prevent the video from opening.
        }
        if (!subtitleConfigurations.isEmpty()) builder.setSubtitleConfigurations(subtitleConfigurations);
        return builder.build();
    }

    private void initializePlayer() {
        if (player != null) return;
        DefaultHttpDataSource.Factory httpFactory = new DefaultHttpDataSource.Factory()
            .setUserAgent("InfinityPlay Android")
            .setAllowCrossProtocolRedirects(true)
            .setConnectTimeoutMs(15_000)
            .setReadTimeoutMs(30_000);
        player = new ExoPlayer.Builder(this)
            .setMediaSourceFactory(new DefaultMediaSourceFactory(httpFactory))
            .build();
        player.addListener(new Player.Listener() {
            @Override
            public void onPlaybackStateChanged(int state) {
                ended = state == Player.STATE_ENDED;
            }

            @Override
            public void onPlayerError(PlaybackException error) {
                playbackError = error.getErrorCodeName() + ": " + (error.getMessage() == null ? "Playback failed" : error.getMessage());
                playerView.setCustomErrorMessage("Playback stopped\n" + playbackError);
            }
        });
        playerView.setPlayer(player);
        // Supplying the resume position with the media item is reliable even before the
        // remote MP4 timeline is known. A separate early seek can be discarded while the
        // extractor is still discovering the file duration.
        player.setMediaItem(createMediaItem(), startPositionMs);
        player.prepare();
        player.setPlayWhenReady(true);
    }

    private void finishWithResult(boolean completedNormally) {
        Intent result = new Intent();
        long position = player == null ? startPositionMs : Math.max(0L, player.getCurrentPosition());
        long duration = player == null || player.getDuration() == C.TIME_UNSET ? 0L : Math.max(0L, player.getDuration());
        result.putExtra(RESULT_POSITION_MS, position);
        result.putExtra(RESULT_DURATION_MS, duration);
        result.putExtra(RESULT_ENDED, ended);
        result.putExtra(RESULT_ERROR, playbackError);
        setResult(completedNormally ? Activity.RESULT_OK : Activity.RESULT_CANCELED, result);
    }

    @Override
    protected void onStart() {
        super.onStart();
        initializePlayer();
    }

    @Override
    protected void onStop() {
        finishWithResult(true);
        if (player != null) {
            playerView.setPlayer(null);
            player.release();
            player = null;
        }
        super.onStop();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) enterImmersiveMode();
    }
}
