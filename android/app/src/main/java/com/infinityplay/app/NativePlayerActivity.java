package com.infinityplay.app;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.TextView;

import androidx.activity.OnBackPressedCallback;
import androidx.annotation.Nullable;
import androidx.annotation.OptIn;
import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.DataSpec;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.datasource.ResolvingDataSource;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.exoplayer.trackselection.DefaultTrackSelector;
import androidx.media3.ui.PlayerView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;

/** Full-screen Media3 player for Android VOD, HLS/DASH IPTV, and RTSP sources. */
@OptIn(markerClass = UnstableApi.class)
public class NativePlayerActivity extends AppCompatActivity {
    public static final String EXTRA_URL = "url";
    public static final String EXTRA_TITLE = "title";
    public static final String EXTRA_POSITION_MS = "positionMs";
    public static final String EXTRA_SUBTITLES_JSON = "subtitlesJson";
    public static final String EXTRA_RELEASES_JSON = "releasesJson";
    public static final String EXTRA_HEADERS_JSON = "headersJson";
    public static final String EXTRA_LIVE = "live";
    public static final String RESULT_POSITION_MS = "positionMs";
    public static final String RESULT_DURATION_MS = "durationMs";
    public static final String RESULT_ENDED = "ended";
    public static final String RESULT_ERROR = "error";

    private PlayerView playerView;
    private TextView qualityButton;
    private ExoPlayer player;
    private DefaultTrackSelector trackSelector;
    private JSONArray releases = new JSONArray();
    private int activeReleaseIndex;
    private long startPositionMs;
    private boolean ended;
    private boolean live;
    private String playbackError = "";
    private String signedQuery = "";
    private String signedHost = "";
    private String signedDirectory = "";

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        enterImmersiveMode();
        live = getIntent().getBooleanExtra(EXTRA_LIVE, false);
        startPositionMs = getIntent().getLongExtra(EXTRA_POSITION_MS, 0L);
        releases = readReleases();
        activeReleaseIndex = findInitialRelease();

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

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        root.addView(playerView, new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT
        ));
        qualityButton = createQualityButton();
        FrameLayout.LayoutParams qualityLayout = new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.WRAP_CONTENT,
            dp(44)
        );
        qualityLayout.gravity = Gravity.TOP | Gravity.END;
        qualityLayout.setMargins(dp(16), dp(16), dp(16), 0);
        root.addView(qualityButton, qualityLayout);
        setContentView(root);
        updateQualityButton();

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                finishWithResult(true);
                finish();
            }
        });
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private TextView createQualityButton() {
        TextView button = new TextView(this);
        button.setTextColor(Color.WHITE);
        button.setTextSize(14);
        button.setGravity(Gravity.CENTER);
        button.setPadding(dp(15), 0, dp(15), 0);
        button.setMinWidth(dp(82));
        GradientDrawable background = new GradientDrawable();
        background.setColor(0xD91A1B22);
        background.setStroke(dp(1), 0x55FFFFFF);
        background.setCornerRadius(dp(10));
        button.setBackground(background);
        button.setOnClickListener(view -> showQualityPicker());
        return button;
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

    private JSONArray readReleases() {
        try {
            JSONArray parsed = new JSONArray(getIntent().getStringExtra(EXTRA_RELEASES_JSON));
            if (parsed.length() > 0) return parsed;
        } catch (Exception ignored) {
            // The current URL below remains a valid single source.
        }
        JSONArray fallback = new JSONArray();
        JSONObject source = new JSONObject();
        try {
            source.put("url", getIntent().getStringExtra(EXTRA_URL));
            source.put("resolution", 0);
            source.put("kind", live ? "hls" : "mp4");
            fallback.put(source);
        } catch (Exception ignored) {
            // URL validation already happened in the Capacitor plugin.
        }
        return fallback;
    }

    private int findInitialRelease() {
        String wantedUrl = getIntent().getStringExtra(EXTRA_URL);
        for (int index = 0; index < releases.length(); index++) {
            JSONObject release = releases.optJSONObject(index);
            if (release != null && wantedUrl.equals(release.optString("url"))) return index;
        }
        return 0;
    }

    private JSONObject activeRelease() {
        JSONObject release = releases.optJSONObject(activeReleaseIndex);
        return release == null ? new JSONObject() : release;
    }

    private Map<String, String> requestHeaders(JSONObject release) {
        Map<String, String> headers = new HashMap<>();
        try {
            JSONObject rootHeaders = new JSONObject(getIntent().getStringExtra(EXTRA_HEADERS_JSON));
            copyHeaders(rootHeaders, headers);
            JSONObject releaseHeaders = release.optJSONObject("headers");
            if (releaseHeaders != null) copyHeaders(releaseHeaders, headers);
        } catch (Exception ignored) {
            // Header-free public media remains playable.
        }
        return headers;
    }

    private void copyHeaders(JSONObject source, Map<String, String> target) {
        Iterator<String> keys = source.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            String value = source.optString(key, "");
            if (!value.isEmpty()) target.put(key, value);
        }
    }

    private void updateSignedPath(String sourceUrl) {
        signedQuery = "";
        signedHost = "";
        signedDirectory = "";
        try {
            Uri uri = Uri.parse(sourceUrl);
            String query = uri.getEncodedQuery();
            if (query == null || !query.contains("Policy=")) return;
            signedQuery = query;
            signedHost = uri.getHost() == null ? "" : uri.getHost();
            String path = uri.getPath() == null ? "" : uri.getPath();
            int slash = path.lastIndexOf('/');
            signedDirectory = slash < 0 ? "" : path.substring(0, slash + 1);
        } catch (Exception ignored) {
            // Non-signed URLs need no segment rewrite.
        }
    }

    private DataSpec resolveSignedSegment(DataSpec dataSpec) {
        if (signedQuery.isEmpty()) return dataSpec;
        Uri uri = dataSpec.uri;
        String host = uri.getHost();
        String path = uri.getPath();
        String query = uri.getEncodedQuery();
        if (!signedHost.equals(host) || path == null || !path.startsWith(signedDirectory)
            || (query != null && query.contains("Policy="))) return dataSpec;
        String combined = query == null || query.isEmpty() ? signedQuery : query + "&" + signedQuery;
        return dataSpec.withUri(uri.buildUpon().encodedQuery(combined).build());
    }

    private MediaItem createMediaItem(JSONObject release) {
        String url = release.optString("url", getIntent().getStringExtra(EXTRA_URL));
        MediaItem.Builder builder = new MediaItem.Builder().setUri(Uri.parse(url));
        String path = Uri.parse(url).getPath();
        if (path != null && path.toLowerCase().endsWith(".mpd")) builder.setMimeType(MimeTypes.APPLICATION_MPD);
        else if (path != null && path.toLowerCase().endsWith(".m3u8")) builder.setMimeType(MimeTypes.APPLICATION_M3U8);

        if (!live) {
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
                // A malformed optional subtitle must never prevent playback.
            }
            if (!subtitleConfigurations.isEmpty()) builder.setSubtitleConfigurations(subtitleConfigurations);
        }
        return builder.build();
    }

    private void initializePlayer() {
        if (player != null) return;
        JSONObject release = activeRelease();
        Map<String, String> headers = requestHeaders(release);
        String userAgent = headers.remove("User-Agent");
        DefaultHttpDataSource.Factory httpFactory = new DefaultHttpDataSource.Factory()
            .setUserAgent(userAgent == null || userAgent.isEmpty() ? "InfinityPlay Android" : userAgent)
            .setAllowCrossProtocolRedirects(true)
            .setConnectTimeoutMs(15_000)
            .setReadTimeoutMs(30_000)
            .setDefaultRequestProperties(headers);
        ResolvingDataSource.Factory resolvingFactory = new ResolvingDataSource.Factory(
            httpFactory,
            this::resolveSignedSegment
        );
        trackSelector = new DefaultTrackSelector(this);
        player = new ExoPlayer.Builder(this)
            .setTrackSelector(trackSelector)
            .setMediaSourceFactory(new DefaultMediaSourceFactory(resolvingFactory))
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
        loadRelease(activeReleaseIndex, startPositionMs);
    }

    private void applyResolutionLimit(int resolution) {
        if (trackSelector == null) return;
        DefaultTrackSelector.Parameters.Builder parameters = trackSelector.buildUponParameters();
        if (resolution > 0) parameters.setMaxVideoSize(Integer.MAX_VALUE, resolution);
        trackSelector.setParameters(parameters);
    }

    private void loadRelease(int index, long positionMs) {
        if (player == null || index < 0 || index >= releases.length()) return;
        activeReleaseIndex = index;
        JSONObject release = activeRelease();
        String url = release.optString("url", getIntent().getStringExtra(EXTRA_URL));
        updateSignedPath(url);
        applyResolutionLimit(release.optInt("resolution", 0));
        playbackError = "";
        playerView.setCustomErrorMessage(null);
        player.setMediaItem(createMediaItem(release), live ? C.TIME_UNSET : Math.max(0L, positionMs));
        player.prepare();
        player.setPlayWhenReady(true);
        updateQualityButton();
    }

    private String releaseLabel(JSONObject release) {
        int resolution = release.optInt("resolution", 0);
        if (resolution <= 0) return live ? "LIVE" : "AUTO";
        return resolution + "p";
    }

    private void updateQualityButton() {
        if (qualityButton == null) return;
        qualityButton.setText(releaseLabel(activeRelease()));
        qualityButton.setVisibility(releases.length() > 1 ? View.VISIBLE : View.GONE);
    }

    private void showQualityPicker() {
        if (releases.length() < 2) return;
        String[] labels = new String[releases.length()];
        for (int index = 0; index < releases.length(); index++) {
            JSONObject release = releases.optJSONObject(index);
            String kind = release == null ? "" : release.optString("kind", "mp4");
            labels[index] = releaseLabel(release == null ? new JSONObject() : release)
                + ("dash".equals(kind) ? " · Adaptive" : " · Direct");
        }
        new AlertDialog.Builder(this)
            .setTitle("Video quality")
            .setSingleChoiceItems(labels, activeReleaseIndex, (dialog, which) -> {
                long position = player == null ? startPositionMs : player.getCurrentPosition();
                loadRelease(which, position);
                dialog.dismiss();
            })
            .setNegativeButton("Cancel", null)
            .show();
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
