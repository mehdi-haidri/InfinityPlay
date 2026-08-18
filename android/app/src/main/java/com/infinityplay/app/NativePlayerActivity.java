package com.infinityplay.app;

import android.app.Activity;
import android.app.PictureInPictureParams;
import android.content.Intent;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.os.Build;
import android.util.Rational;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.activity.OnBackPressedCallback;
import androidx.annotation.Nullable;
import androidx.annotation.OptIn;
import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import androidx.media3.common.C;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.Format;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.TrackSelectionOverride;
import androidx.media3.common.Tracks;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.DataSpec;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.datasource.ResolvingDataSource;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.exoplayer.trackselection.DefaultTrackSelector;
import androidx.media3.ui.PlayerView;
import androidx.media3.ui.AspectRatioFrameLayout;
import androidx.mediarouter.app.MediaRouteButton;

import com.google.android.gms.cast.MediaInfo;
import com.google.android.gms.cast.MediaLoadRequestData;
import com.google.android.gms.cast.MediaMetadata;
import com.google.android.gms.cast.MediaStatus;
import com.google.android.gms.cast.MediaTrack;
import com.google.android.gms.cast.framework.CastButtonFactory;
import com.google.android.gms.cast.framework.CastContext;
import com.google.android.gms.cast.framework.CastSession;
import com.google.android.gms.cast.framework.SessionManagerListener;
import com.google.android.gms.cast.framework.media.RemoteMediaClient;
import com.google.android.gms.common.images.WebImage;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/** Full-screen Media3 player for Android VOD, HLS/DASH IPTV, and RTSP sources. */
@OptIn(markerClass = UnstableApi.class)
public class NativePlayerActivity extends AppCompatActivity {
    public static final String EXTRA_URL = "url";
    public static final String EXTRA_TITLE = "title";
    public static final String EXTRA_POSTER_URL = "posterUrl";
    public static final String EXTRA_POSITION_MS = "positionMs";
    public static final String EXTRA_SUBTITLES_JSON = "subtitlesJson";
    public static final String EXTRA_RELEASES_JSON = "releasesJson";
    public static final String EXTRA_HEADERS_JSON = "headersJson";
    public static final String EXTRA_PREFERRED_AUDIO = "preferredAudioLanguage";
    public static final String EXTRA_PREFERRED_SUBTITLE = "preferredSubtitleLanguage";
    public static final String EXTRA_HAS_PREVIOUS_EPISODE = "hasPreviousEpisode";
    public static final String EXTRA_HAS_NEXT_EPISODE = "hasNextEpisode";
    public static final String EXTRA_AUTOPLAY_NEXT = "autoplayNext";
    public static final String EXTRA_LIVE = "live";
    public static final String RESULT_POSITION_MS = "positionMs";
    public static final String RESULT_DURATION_MS = "durationMs";
    public static final String RESULT_ENDED = "ended";
    public static final String RESULT_ERROR = "error";
    public static final String RESULT_CAST_REQUESTED = "castRequested";
    public static final String RESULT_SUBTITLE_URL = "subtitleUrl";
    public static final String RESULT_SUBTITLE_NAME = "subtitleName";
    public static final String RESULT_SUBTITLE_LANGUAGE = "subtitleLanguage";
    public static final String RESULT_SUBTITLE_CHANGED = "subtitleChanged";
    public static final String RESULT_EPISODE_STEP = "episodeStep";

    private PlayerView playerView;
    /** Quality keeps its label — which one is playing is information, not an icon. */
    private TextView qualityButton;
    private ImageView audioButton;
    private ImageView previousEpisodeButton;
    private ImageView nextEpisodeButton;
    private ImageView pipButton;
    private ImageView optionsButton;
    private LinearLayout quickActions;
    private ExoPlayer player;
    private DefaultTrackSelector trackSelector;
    private JSONArray releases = new JSONArray();
    private int activeReleaseIndex;
    private long startPositionMs;
    private boolean ended;
    /** The setting only updates globally when the viewer actually changes this picker. */
    private boolean subtitleChanged;
    /** The option chosen in this activity, kept even while Media3 is still loading its text tracks. */
    private String selectedSubtitlePreference = "";
    private boolean live;
    private boolean castRequested;
    private CastContext castContext;
    private CastProxy castProxy;
    private SessionManagerListener<CastSession> castSessionListener;
    private String playbackError = "";
    private String signedQuery = "";
    private String signedHost = "";
    private String signedDirectory = "";
    private int resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT;
    /** A non-zero value is returned to the shared layer, which resolves the next signed source. */
    private int episodeStep;
    private boolean episodeNavigationRequested;
    private RemoteMediaClient remoteMediaClient;
    private RemoteMediaClient.Callback remoteMediaCallback;
    /** Avoid treating the old Chromecast item's FINISHED status as the newly loaded item's end. */
    private boolean remotePlaybackStarted;

    /** English is the fallback; only these languages are exposed in the mobile player. */
    private static final String[] SUPPORTED_AUDIO_TAGS = {"en", "ar", "fr"};

    @Nullable
    private String supportedAudioTag(@Nullable String value) {
        if (value == null) return null;
        String normalized = value.trim().toLowerCase(java.util.Locale.ROOT).replace('_', '-');
        if (normalized.equals("en") || normalized.equals("eng") || normalized.startsWith("en-") || normalized.contains("english")) return "en";
        if (normalized.equals("ar") || normalized.equals("ara") || normalized.startsWith("ar-") || normalized.contains("arabic")) return "ar";
        if (normalized.equals("fr") || normalized.equals("fra") || normalized.equals("fre") || normalized.startsWith("fr-") || normalized.contains("french")) return "fr";
        return null;
    }

    @Nullable
    private String supportedAudioTag(Format format) {
        // A declared language is authoritative. Only fall back to the label when the
        // manifest omitted it; this prevents a Hindi track with a vague label leaking in.
        if (format.language != null && !format.language.trim().isEmpty()) {
            return supportedAudioTag(format.language);
        }
        return supportedAudioTag(format.label);
    }

    private String audioName(String tag) {
        if ("ar".equals(tag)) return "Arabic";
        if ("fr".equals(tag)) return "French";
        return "English";
    }

    private String[] audioPreferenceOrder(@Nullable String configured) {
        String selected = supportedAudioTag(configured);
        if (selected == null) selected = "en";
        List<String> order = new ArrayList<>();
        order.add(selected);
        for (String tag : SUPPORTED_AUDIO_TAGS) {
            if (!tag.equals(selected)) order.add(tag);
        }
        return order.toArray(new String[0]);
    }

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        enterImmersiveMode();
        live = getIntent().getBooleanExtra(EXTRA_LIVE, false);
        startPositionMs = getIntent().getLongExtra(EXTRA_POSITION_MS, 0L);
        String preferredSubtitle = getIntent().getStringExtra(EXTRA_PREFERRED_SUBTITLE);
        selectedSubtitlePreference = preferredSubtitle == null ? "" : preferredSubtitle;
        releases = readReleases();
        activeReleaseIndex = findInitialRelease();

        playerView = new PlayerView(this);
        playerView.setBackgroundColor(Color.BLACK);
        playerView.setUseController(true);
        playerView.setControllerAutoShow(true);
        playerView.setControllerHideOnTouch(true);
        playerView.setControllerShowTimeoutMs(3500);
        playerView.setShowBuffering(PlayerView.SHOW_BUFFERING_WHEN_PLAYING);
        // The app owns one subtitle picker in the overflow menu. Leaving Media3's built-in button
        // on created a second, independent way to change captions with different persistence.
        playerView.setShowSubtitleButton(false);
        playerView.setShowNextButton(false);
        playerView.setShowPreviousButton(false);
        playerView.setContentDescription(getIntent().getStringExtra(EXTRA_TITLE));

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        root.addView(playerView, new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT
        ));
        quickActions = new LinearLayout(this);
        quickActions.setOrientation(LinearLayout.HORIZONTAL);
        quickActions.setGravity(Gravity.CENTER_VERTICAL);
        playerView.setControllerVisibilityListener(new PlayerView.ControllerVisibilityListener() {
            @Override
            public void onVisibilityChanged(int visibility) {
                if (quickActions == null || (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N && isInPictureInPictureMode())) return;
                quickActions.setVisibility(visibility == View.VISIBLE ? View.VISIBLE : View.GONE);
            }
        });
        /*
         * One control per action, drawn with the same glyphs as the desktop player.
         *
         * This row used to carry text labels — AUTO, Audio, More, DLNA, PiP — beside Google's cast
         * button, which meant two separate controls for casting and a bar that looked nothing like
         * the rest of the app. Quality still shows its label, because which quality is playing is
         * information rather than an icon; everything else is an icon with the label kept as its
         * accessible name. DLNA moved into the overflow menu, so casting starts in one place.
         */
        qualityButton = createActionButton("AUTO", view -> showQualityPicker());
        audioButton = createIconButton(R.drawable.ic_player_audio, "Audio language", view -> showAudioPicker());
        optionsButton = createIconButton(R.drawable.ic_player_more, "More options", view -> showPlaybackOptions());
        if (hasPreviousEpisode()) {
            previousEpisodeButton = createIconButton(
                R.drawable.ic_player_previous,
                "Previous episode",
                view -> requestEpisodeStep(-1)
            );
            quickActions.addView(previousEpisodeButton);
        }
        if (hasNextEpisode()) {
            nextEpisodeButton = createIconButton(
                R.drawable.ic_player_next,
                "Next episode",
                view -> requestEpisodeStep(1)
            );
            quickActions.addView(nextEpisodeButton);
        }
        quickActions.addView(qualityButton);
        quickActions.addView(audioButton);
        addChromecastButton();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && getPackageManager().hasSystemFeature("android.software.picture_in_picture")) {
            pipButton = createIconButton(R.drawable.ic_player_pip, "Picture in picture", view -> enterPip());
            quickActions.addView(pipButton);
        }
        quickActions.addView(optionsButton);
        FrameLayout.LayoutParams actionsLayout = new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.WRAP_CONTENT, dp(48)
        );
        actionsLayout.gravity = Gravity.TOP | Gravity.END;
        actionsLayout.setMargins(dp(12), dp(12), dp(12), 0);
        root.addView(quickActions, actionsLayout);
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

    /** Google's standard route picker. DLNA is reached from the overflow menu, not a second button. */
    private void addChromecastButton() {
        try {
            castContext = CastContext.getSharedInstance(this);
            MediaRouteButton button = new MediaRouteButton(this);
            LinearLayout.LayoutParams layout = new LinearLayout.LayoutParams(dp(48), dp(42));
            layout.setMarginStart(dp(6));
            button.setLayoutParams(layout);
            button.setContentDescription("Cast to Chromecast");
            CastButtonFactory.setUpMediaRouteButton(getApplicationContext(), button);
            quickActions.addView(button);
            castSessionListener = new SessionManagerListener<CastSession>() {
                @Override public void onSessionStarting(CastSession session) {}
                @Override public void onSessionStarted(CastSession session, String sessionId) { loadRemoteMedia(session); }
                @Override public void onSessionStartFailed(CastSession session, int error) {
                    Toast.makeText(NativePlayerActivity.this, "Chromecast connection failed.", Toast.LENGTH_SHORT).show();
                }
                @Override public void onSessionEnding(CastSession session) {}
                @Override public void onSessionEnded(CastSession session, int error) {
                    clearRemotePlaybackObserver();
                    if (castProxy != null) castProxy.stop();
                    castProxy = null;
                }
                @Override public void onSessionResuming(CastSession session, String sessionId) {}
                @Override public void onSessionResumed(CastSession session, boolean wasSuspended) { loadRemoteMedia(session); }
                @Override public void onSessionResumeFailed(CastSession session, int error) {}
                @Override public void onSessionSuspended(CastSession session, int reason) {}
            };
        } catch (Exception unavailable) {
            // Phones without Google Play services still retain the adjacent DLNA action.
            castContext = null;
            castSessionListener = null;
        }
    }

    private boolean hasPreviousEpisode() {
        return !live && getIntent().getBooleanExtra(EXTRA_HAS_PREVIOUS_EPISODE, false);
    }

    private boolean hasNextEpisode() {
        return !live && getIntent().getBooleanExtra(EXTRA_HAS_NEXT_EPISODE, false);
    }

    private boolean shouldAutoplayNext() {
        return hasNextEpisode() && getIntent().getBooleanExtra(EXTRA_AUTOPLAY_NEXT, false);
    }

    /**
     * Release this activity so the shared TypeScript player can fetch the next episode's fresh,
     * signed URL. Keeping that resolution in one place means native playback, Chromecast and
     * DLNA all move through the exact same episode order.
     */
    private void requestEpisodeStep(int step) {
        if (episodeNavigationRequested || (step < 0 && !hasPreviousEpisode()) || (step > 0 && !hasNextEpisode())) return;
        episodeNavigationRequested = true;
        episodeStep = step < 0 ? -1 : 1;
        if (player != null) player.pause();
        finishWithResult(true);
        finish();
    }

    /** Watches a Chromecast item after it has started, then returns for the next signed episode. */
    private void observeRemotePlayback(RemoteMediaClient client) {
        if (remoteMediaClient == client && remoteMediaCallback != null) return;
        clearRemotePlaybackObserver();
        remoteMediaClient = client;
        remotePlaybackStarted = false;
        remoteMediaCallback = new RemoteMediaClient.Callback() {
            @Override
            public void onStatusUpdated() {
                if (remoteMediaClient == null || episodeNavigationRequested) return;
                int state = remoteMediaClient.getPlayerState();
                if (state == MediaStatus.PLAYER_STATE_PLAYING) {
                    remotePlaybackStarted = true;
                    return;
                }
                if (remotePlaybackStarted
                    && state == MediaStatus.PLAYER_STATE_IDLE
                    && remoteMediaClient.getIdleReason() == MediaStatus.IDLE_REASON_FINISHED
                    && shouldAutoplayNext()) {
                    requestEpisodeStep(1);
                }
            }
        };
        client.registerCallback(remoteMediaCallback);
    }

    private void clearRemotePlaybackObserver() {
        if (remoteMediaClient != null && remoteMediaCallback != null) {
            remoteMediaClient.unregisterCallback(remoteMediaCallback);
        }
        remoteMediaClient = null;
        remoteMediaCallback = null;
        remotePlaybackStarted = false;
    }

    @Nullable
    private JSONObject selectedSubtitle() {
        JSONArray options = subtitleOptions();
        if (selectedSubtitlePreference.isEmpty() || "off".equalsIgnoreCase(selectedSubtitlePreference)) return null;
        for (int index = 0; index < options.length(); index++) {
            JSONObject option = options.optJSONObject(index);
            if (matchesSubtitlePreference(option, selectedSubtitlePreference)) return option;
        }
        if (player != null) {
            for (Tracks.Group group : player.getCurrentTracks().getGroups()) {
                if (group.getType() != C.TRACK_TYPE_TEXT) continue;
                for (int index = 0; index < group.length; index++) {
                    if (!group.isTrackSelected(index)) continue;
                    String id = group.getTrackFormat(index).id;
                    if (id != null && id.startsWith("infinityplay-subtitle-")) {
                        try {
                            int selected = Integer.parseInt(id.substring("infinityplay-subtitle-".length()));
                            return options.optJSONObject(selected);
                        } catch (Exception ignored) {
                            // Fall through to the configured-language match below.
                        }
                    }
                }
            }
        }
        return null;
    }

    private JSONArray subtitleOptions() {
        try {
            return new JSONArray(getIntent().getStringExtra(EXTRA_SUBTITLES_JSON));
        } catch (Exception ignored) {
            return new JSONArray();
        }
    }

    private boolean matchesSubtitlePreference(@Nullable JSONObject option, @Nullable String wanted) {
        if (option == null || wanted == null || wanted.isEmpty()) return false;
        return wanted.equalsIgnoreCase(option.optString("lang")) || wanted.equalsIgnoreCase(option.optString("name"));
    }

    private String castMimeType(String url) {
        String path = Uri.parse(url).getPath();
        String lower = path == null ? "" : path.toLowerCase(java.util.Locale.ROOT);
        if (lower.endsWith(".m3u8")) return MimeTypes.APPLICATION_M3U8;
        if (lower.endsWith(".mpd")) return MimeTypes.APPLICATION_MPD;
        if (lower.endsWith(".webm")) return MimeTypes.VIDEO_WEBM;
        return MimeTypes.VIDEO_MP4;
    }

    private String fetchSubtitleVtt(String url) throws Exception {
        if (url == null || !(url.startsWith("http://") || url.startsWith("https://"))) return "";
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setConnectTimeout(15_000);
        connection.setReadTimeout(15_000);
        connection.setRequestProperty("User-Agent", "InfinityPlay Android");
        try (InputStream input = connection.getInputStream(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[16 * 1024];
            int read;
            while ((read = input.read(buffer)) != -1) output.write(buffer, 0, read);
            String raw = output.toString(StandardCharsets.UTF_8.name())
                .replace("\r\n", "\n")
                .replace('\r', '\n')
                .replace("\uFEFF", "");
            if (raw.trim().startsWith("WEBVTT")) return raw;
            StringBuilder vtt = new StringBuilder("WEBVTT\n\n");
            for (String line : raw.split("\n", -1)) {
                if (line.trim().matches("\\d+")) continue;
                if (line.contains("-->")) line = line.replace(',', '.');
                vtt.append(line).append('\n');
            }
            return vtt.toString();
        } finally {
            connection.disconnect();
        }
    }

    private void loadRemoteMedia(CastSession session) {
        if (session == null) return;
        final long position = player == null ? startPositionMs : Math.max(0L, player.getCurrentPosition());
        final JSONObject release = castRelease();
        if (release == null) {
            Toast.makeText(
                this,
                "This title has no direct stream that a Chromecast can play.",
                Toast.LENGTH_LONG
            ).show();
            return;
        }
        final String originalUrl = release.optString("url", getIntent().getStringExtra(EXTRA_URL));
        final JSONObject subtitle = selectedSubtitle();

        new Thread(() -> {
            String videoUrl = originalUrl;
            String subtitleUrl = "";
            try {
                if (CastProxy.needsProxy(originalUrl)) {
                    if (castProxy == null) castProxy = new CastProxy(getApplicationContext());
                    videoUrl = castProxy.publish(originalUrl);
                }
                if (subtitle != null) {
                    String vtt = fetchSubtitleVtt(subtitle.optString("url", ""));
                    if (!vtt.isEmpty()) {
                        if (castProxy == null) castProxy = new CastProxy(getApplicationContext());
                        subtitleUrl = castProxy.publishText(vtt, ".vtt", "text/vtt; charset=utf-8");
                    }
                }
            } catch (Exception error) {
                final String message = error.getMessage();
                runOnUiThread(() -> Toast.makeText(
                    NativePlayerActivity.this,
                    message == null ? "The stream could not be shared with Chromecast." : message,
                    Toast.LENGTH_LONG
                ).show());
                return;
            }

            final String remoteVideoUrl = videoUrl;
            final String remoteSubtitleUrl = subtitleUrl;
            runOnUiThread(() -> {
                CastSession active = castContext == null ? null : castContext.getSessionManager().getCurrentCastSession();
                if (active == null || active != session) return;
                RemoteMediaClient client = active.getRemoteMediaClient();
                if (client == null) return;

                MediaMetadata metadata = new MediaMetadata(MediaMetadata.MEDIA_TYPE_MOVIE);
                metadata.putString(MediaMetadata.KEY_TITLE, getIntent().getStringExtra(EXTRA_TITLE));
                String posterUrl = getIntent().getStringExtra(EXTRA_POSTER_URL);
                if (posterUrl != null && !posterUrl.isEmpty()) metadata.addImage(new WebImage(Uri.parse(posterUrl)));

                MediaInfo.Builder info = new MediaInfo.Builder(remoteVideoUrl)
                    .setContentType(castMimeType(originalUrl))
                    .setStreamType(live ? MediaInfo.STREAM_TYPE_LIVE : MediaInfo.STREAM_TYPE_BUFFERED)
                    .setMetadata(metadata);
                long[] activeTracks = null;
                if (!remoteSubtitleUrl.isEmpty()) {
                    String name = subtitle == null ? "Subtitles" : subtitle.optString("name", "Subtitles");
                    String language = subtitle == null ? "und" : subtitle.optString("lang", "und");
                    MediaTrack track = new MediaTrack.Builder(1L, MediaTrack.TYPE_TEXT)
                        .setContentId(remoteSubtitleUrl)
                        .setContentType("text/vtt")
                        .setSubtype(MediaTrack.SUBTYPE_SUBTITLES)
                        .setName(name)
                        .setLanguage(language)
                        .build();
                    info.setMediaTracks(java.util.Collections.singletonList(track));
                    activeTracks = new long[] {1L};
                }
                MediaLoadRequestData.Builder load = new MediaLoadRequestData.Builder()
                    .setMediaInfo(info.build())
                    .setAutoplay(true)
                    .setCurrentTime(live ? 0L : position);
                if (activeTracks != null) load.setActiveTrackIds(activeTracks);
                observeRemotePlayback(client);
                client.load(load.build());
                if (player != null) player.pause();
                Toast.makeText(NativePlayerActivity.this, "Playing on Chromecast", Toast.LENGTH_SHORT).show();
            });
        }, "infinityplay-chromecast-load").start();
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private TextView createActionButton(String label, View.OnClickListener listener) {
        TextView button = new TextView(this);
        button.setText(label);
        button.setTextColor(Color.WHITE);
        button.setTextSize(14);
        button.setGravity(Gravity.CENTER);
        button.setPadding(dp(13), 0, dp(13), 0);
        button.setMinWidth(dp(68));
        LinearLayout.LayoutParams layout = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT, dp(42)
        );
        layout.setMarginStart(dp(6));
        button.setLayoutParams(layout);
        button.setBackground(actionBackground());
        button.setOnClickListener(listener);
        return button;
    }

    /**
     * The icon form of {@link #createActionButton}, for the actions the desktop player also draws
     * as icons. The label stays on as the accessible name and the long-press tooltip.
     */
    private ImageView createIconButton(int drawable, String label, View.OnClickListener listener) {
        ImageView button = new ImageView(this);
        button.setImageResource(drawable);
        button.setScaleType(ImageView.ScaleType.CENTER_INSIDE);
        button.setPadding(dp(11), dp(11), dp(11), dp(11));
        button.setContentDescription(label);
        LinearLayout.LayoutParams layout = new LinearLayout.LayoutParams(dp(42), dp(42));
        layout.setMarginStart(dp(6));
        button.setLayoutParams(layout);
        button.setBackground(actionBackground());
        button.setOnClickListener(listener);
        return button;
    }

    /** The pill every control in this row sits on, so the bar reads as one piece. */
    private GradientDrawable actionBackground() {
        GradientDrawable background = new GradientDrawable();
        background.setColor(0xD91A1B22);
        background.setStroke(dp(1), 0x55FFFFFF);
        background.setCornerRadius(dp(10));
        return background;
    }

    private void enterPip() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || player == null) return;
        try {
            PictureInPictureParams.Builder builder = new PictureInPictureParams.Builder()
                .setAspectRatio(new Rational(16, 9));
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) builder.setSeamlessResizeEnabled(true);
            enterPictureInPictureMode(builder.build());
        } catch (Exception ignored) {
            playerView.showController();
        }
    }

    /** Returns to the shared mobile cast controller, which discovers standards-based DLNA TVs. */
    private void requestDlnaCast() {
        castRequested = true;
        if (player != null) player.pause();
        finishWithResult(true);
        finish();
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

    /**
     * A Cast receiver cannot play the catalog's adaptive source. Its manifest has relative media
     * segments, and those segments are protected by the app's signed-request hook; handing the
     * manifest to a TV therefore leaves it on a loading screen. Choose the same direct source the
     * shared React cast path selects: the matching height when it exists, otherwise the best direct
     * release. The local player can continue using the selected adaptive release independently.
     */
    @Nullable
    private JSONObject castRelease() {
        JSONObject current = activeRelease();
        int wantedResolution = current.optInt("resolution", 0);
        JSONObject fallback = null;

        for (int index = 0; index < releases.length(); index++) {
            JSONObject candidate = releases.optJSONObject(index);
            if (candidate == null || "dash".equalsIgnoreCase(candidate.optString("kind", "mp4"))) continue;
            if (wantedResolution > 0 && candidate.optInt("resolution", 0) == wantedResolution) return candidate;
            if (fallback == null) fallback = candidate;
        }

        return fallback;
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
                            .setId("infinityplay-subtitle-" + index)
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
        DefaultTrackSelector.Parameters.Builder initialTracks = trackSelector.buildUponParameters();
        String preferredAudio = getIntent().getStringExtra(EXTRA_PREFERRED_AUDIO);
        // Media3 expects BCP-47 tags, not labels such as "English". Supplying an ordered
        // list fixes manifests whose first/default track is Hindi while English is present.
        initialTracks.setPreferredAudioLanguages(audioPreferenceOrder(preferredAudio));
        if (!selectedSubtitlePreference.isEmpty() && !"off".equalsIgnoreCase(selectedSubtitlePreference)) {
            initialTracks.setPreferredTextLanguage(selectedSubtitlePreference);
        } else {
            initialTracks.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true);
        }
        trackSelector.setParameters(initialTracks);
        player = new ExoPlayer.Builder(this)
            .setTrackSelector(trackSelector)
            .setMediaSourceFactory(new DefaultMediaSourceFactory(resolvingFactory))
            .build();
        player.setAudioAttributes(
            new AudioAttributes.Builder()
                .setUsage(C.USAGE_MEDIA)
                .setContentType(C.AUDIO_CONTENT_TYPE_MOVIE)
                .build(),
            true
        );
        player.setHandleAudioBecomingNoisy(true);
        player.addListener(new Player.Listener() {
            @Override
            public void onPlaybackStateChanged(int state) {
                ended = state == Player.STATE_ENDED;
                if (ended && shouldAutoplayNext()) requestEpisodeStep(1);
            }

            @Override
            public void onTracksChanged(Tracks tracks) {
                updateAudioButton(tracks);
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

    private String trackLabel(Format format, String fallback) {
        if (format.label != null && !format.label.trim().isEmpty()) return format.label;
        if (format.language != null && !format.language.trim().isEmpty()) {
            java.util.Locale locale = java.util.Locale.forLanguageTag(format.language);
            String name = locale.getDisplayLanguage();
            return name == null || name.isEmpty() ? format.language : name;
        }
        return fallback;
    }

    private List<Tracks.Group> trackGroups(int type) {
        List<Tracks.Group> groups = new ArrayList<>();
        if (player == null) return groups;
        for (Tracks.Group group : player.getCurrentTracks().getGroups()) {
            if (group.getType() == type && group.isSupported()) groups.add(group);
        }
        return groups;
    }

    private void updateAudioButton(Tracks tracks) {
        if (audioButton == null) return;
        int count = 0;
        String label = "Audio";
        for (Tracks.Group group : tracks.getGroups()) {
            if (group.getType() != C.TRACK_TYPE_AUDIO || !group.isSupported()) continue;
            for (int index = 0; index < group.length; index++) {
                Format format = group.getTrackFormat(index);
                String tag = supportedAudioTag(format);
                if (tag == null || !group.isTrackSupported(index)) continue;
                count += 1;
                if (group.isTrackSelected(index)) label = audioName(tag);
            }
        }
        // The button is an icon now, so the selected language rides on the accessible name.
        audioButton.setContentDescription("Audio language: " + label);
        audioButton.setVisibility(count > 1 ? View.VISIBLE : View.GONE);
    }

    private int supportedAudioTrackCount() {
        int count = 0;
        for (Tracks.Group group : trackGroups(C.TRACK_TYPE_AUDIO)) {
            for (int index = 0; index < group.length; index++) {
                if (group.isTrackSupported(index) && supportedAudioTag(group.getTrackFormat(index)) != null) count += 1;
            }
        }
        return count;
    }

    private void showAudioPicker() {
        List<Tracks.Group> groups = trackGroups(C.TRACK_TYPE_AUDIO);
        List<String> labels = new ArrayList<>();
        List<TrackSelectionOverride> choices = new ArrayList<>();
        int selected = 0;
        for (Tracks.Group group : groups) {
            for (int index = 0; index < group.length; index++) {
                if (!group.isTrackSupported(index)) continue;
                String tag = supportedAudioTag(group.getTrackFormat(index));
                if (tag == null) continue;
                labels.add(audioName(tag));
                choices.add(new TrackSelectionOverride(group.getMediaTrackGroup(), index));
                if (group.isTrackSelected(index)) selected = labels.size() - 1;
            }
        }
        if (choices.size() < 2) return;
        new AlertDialog.Builder(this)
            .setTitle("Audio language")
            .setSingleChoiceItems(labels.toArray(new String[0]), selected, (dialog, which) -> {
                trackSelector.setParameters(
                    trackSelector.buildUponParameters().setOverrideForType(choices.get(which))
                );
                dialog.dismiss();
            })
            .setNegativeButton("Cancel", null)
            .show();
    }

    private void showSubtitlePicker() {
        JSONArray options = subtitleOptions();
        List<String> labels = new ArrayList<>();
        labels.add("Off");
        int selected = 0;
        for (int index = 0; index < options.length(); index++) {
            JSONObject option = options.optJSONObject(index);
            if (option == null) continue;
            labels.add(option.optString("name", "Subtitle " + labels.size()));
            if (matchesSubtitlePreference(option, selectedSubtitlePreference)) selected = labels.size() - 1;
        }
        if (labels.size() < 2) return;
        new AlertDialog.Builder(this)
            .setTitle("Subtitles")
            .setSingleChoiceItems(labels.toArray(new String[0]), selected, (dialog, which) -> {
                subtitleChanged = true;
                DefaultTrackSelector.Parameters.Builder parameters = trackSelector.buildUponParameters()
                    .clearOverridesOfType(C.TRACK_TYPE_TEXT)
                    .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, which == 0);
                if (which > 0) {
                    JSONObject option = options.optJSONObject(which - 1);
                    selectedSubtitlePreference = option == null
                        ? ""
                        : option.optString("lang", option.optString("name", ""));
                    if (selectedSubtitlePreference.isEmpty() && option != null) {
                        selectedSubtitlePreference = option.optString("name", "");
                    }
                    if (!selectedSubtitlePreference.isEmpty()) {
                        parameters.setPreferredTextLanguage(selectedSubtitlePreference);
                    }
                    TrackSelectionOverride override = subtitleOverride(which - 1);
                    if (override != null) parameters.setOverrideForType(override);
                } else {
                    selectedSubtitlePreference = "Off";
                }
                trackSelector.setParameters(parameters);
                dialog.dismiss();
            })
            .setNegativeButton("Cancel", null)
            .show();
    }

    /** A ready track can be selected immediately; otherwise the language preference applies once it loads. */
    @Nullable
    private TrackSelectionOverride subtitleOverride(int optionIndex) {
        String wantedId = "infinityplay-subtitle-" + optionIndex;
        for (Tracks.Group group : trackGroups(C.TRACK_TYPE_TEXT)) {
            for (int index = 0; index < group.length; index++) {
                if (group.isTrackSupported(index) && wantedId.equals(group.getTrackFormat(index).id)) {
                    return new TrackSelectionOverride(group.getMediaTrackGroup(), index);
                }
            }
        }
        return null;
    }

    private void showSpeedPicker() {
        final float[] speeds = {0.5f, 0.75f, 1f, 1.25f, 1.5f, 1.75f, 2f};
        String[] labels = {"0.5×", "0.75×", "Normal", "1.25×", "1.5×", "1.75×", "2×"};
        int selected = 2;
        float currentSpeed = player == null ? 1f : player.getPlaybackParameters().speed;
        for (int index = 0; index < speeds.length; index++) {
            if (Math.abs(speeds[index] - currentSpeed) < 0.01f) selected = index;
        }
        new AlertDialog.Builder(this)
            .setTitle("Playback speed")
            .setSingleChoiceItems(labels, selected, (dialog, which) -> {
                if (player != null) player.setPlaybackSpeed(speeds[which]);
                dialog.dismiss();
            })
            .setNegativeButton("Cancel", null)
            .show();
    }

    private void cycleResizeMode() {
        if (resizeMode == AspectRatioFrameLayout.RESIZE_MODE_FIT) resizeMode = AspectRatioFrameLayout.RESIZE_MODE_ZOOM;
        else if (resizeMode == AspectRatioFrameLayout.RESIZE_MODE_ZOOM) resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FILL;
        else resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT;
        playerView.setResizeMode(resizeMode);
    }

    private void showPlaybackOptions() {
        List<String> labels = new ArrayList<>();
        final int audioIndex;
        if (supportedAudioTrackCount() > 1) {
            audioIndex = labels.size();
            labels.add("Audio language");
        } else {
            audioIndex = -1;
        }
        final int subtitleIndex = labels.size();
        labels.add("Subtitles");
        final int speedIndex;
        if (!live) {
            speedIndex = labels.size();
            labels.add("Playback speed");
        } else {
            speedIndex = -1;
        }
        final int pictureIndex = labels.size();
        labels.add(resizeMode == AspectRatioFrameLayout.RESIZE_MODE_FIT ? "Picture: fit screen" :
            resizeMode == AspectRatioFrameLayout.RESIZE_MODE_ZOOM ? "Picture: fill and crop" : "Picture: stretch");
        // DLNA lives here rather than in the control bar: two cast buttons side by side made the
        // user guess which one their television answered on.
        final int dlnaIndex = labels.size();
        labels.add("Cast to a DLNA television");
        new AlertDialog.Builder(this)
            .setTitle("Playback options")
            .setItems(labels.toArray(new String[0]), (dialog, which) -> {
                if (which == audioIndex) showAudioPicker();
                else if (which == subtitleIndex) showSubtitlePicker();
                else if (which == speedIndex) showSpeedPicker();
                else if (which == pictureIndex) cycleResizeMode();
                else if (which == dlnaIndex) requestDlnaCast();
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
        result.putExtra(RESULT_CAST_REQUESTED, castRequested);
        JSONObject selectedSubtitle = selectedSubtitle();
        result.putExtra(RESULT_SUBTITLE_URL, selectedSubtitle == null ? "" : selectedSubtitle.optString("url", ""));
        result.putExtra(RESULT_SUBTITLE_NAME, selectedSubtitle == null ? "" : selectedSubtitle.optString("name", ""));
        result.putExtra(RESULT_SUBTITLE_LANGUAGE, selectedSubtitle == null ? "" : selectedSubtitle.optString("lang", ""));
        result.putExtra(RESULT_SUBTITLE_CHANGED, subtitleChanged);
        result.putExtra(RESULT_EPISODE_STEP, episodeStep);
        setResult(completedNormally ? Activity.RESULT_OK : Activity.RESULT_CANCELED, result);
    }

    @Override
    protected void onStart() {
        super.onStart();
        if (castContext != null && castSessionListener != null) {
            castContext.getSessionManager().addSessionManagerListener(castSessionListener, CastSession.class);
        }
        initializePlayer();

        // A session can already be connected from the system Cast picker before this activity is
        // opened. Session callbacks only describe future transitions, so without this explicit
        // handoff the TV stays on its previous item even though the player shows as connected.
        CastSession active = castContext == null ? null : castContext.getSessionManager().getCurrentCastSession();
        if (active != null && active.isConnected()) loadRemoteMedia(active);
    }

    @Override
    protected void onStop() {
        finishWithResult(true);
        if (castContext != null && castSessionListener != null) {
            castContext.getSessionManager().removeSessionManagerListener(castSessionListener, CastSession.class);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N && isInPictureInPictureMode()) {
            super.onStop();
            return;
        }
        releasePlayer();
        super.onStop();
    }

    private void releasePlayer() {
        if (player == null) return;
        if (!live) startPositionMs = Math.max(0L, player.getCurrentPosition());
        playerView.setPlayer(null);
        player.release();
        player = null;
    }

    @Override
    protected void onDestroy() {
        releasePlayer();
        clearRemotePlaybackObserver();
        CastSession active = castContext == null ? null : castContext.getSessionManager().getCurrentCastSession();
        if (active == null && castProxy != null) castProxy.stop();
        super.onDestroy();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) enterImmersiveMode();
    }

    @Override
    public void onPictureInPictureModeChanged(boolean isInPictureInPictureMode, Configuration newConfig) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig);
        if (quickActions != null) quickActions.setVisibility(isInPictureInPictureMode ? View.GONE : View.VISIBLE);
        if (isInPictureInPictureMode) playerView.hideController();
        else {
            playerView.showController();
            if (quickActions != null) quickActions.setVisibility(View.VISIBLE);
        }
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        if (player != null && event.getAction() == KeyEvent.ACTION_DOWN) {
            switch (event.getKeyCode()) {
                case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE:
                case KeyEvent.KEYCODE_HEADSETHOOK:
                    if (player.isPlaying()) player.pause(); else player.play();
                    return true;
                case KeyEvent.KEYCODE_MEDIA_PLAY:
                    player.play(); return true;
                case KeyEvent.KEYCODE_MEDIA_PAUSE:
                    player.pause(); return true;
                case KeyEvent.KEYCODE_MEDIA_FAST_FORWARD:
                    if (!live) player.seekTo(player.getCurrentPosition() + 10_000); return true;
                case KeyEvent.KEYCODE_MEDIA_REWIND:
                    if (!live) player.seekTo(Math.max(0, player.getCurrentPosition() - 10_000)); return true;
                case KeyEvent.KEYCODE_MEDIA_NEXT:
                    requestEpisodeStep(1); return true;
                case KeyEvent.KEYCODE_MEDIA_PREVIOUS:
                    requestEpisodeStep(-1); return true;
            }
        }
        return super.dispatchKeyEvent(event);
    }
}
