package com.infinityplay.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

import java.io.File;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Keeps user-requested video downloads alive when the WebView is backgrounded and exposes their
 * progress in Android's notification shade. A download only starts this service from a visible
 * user action, which satisfies Android's foreground-service start restrictions.
 */
public final class DownloadService extends Service {
    private static final String CHANNEL_ID = "offline_downloads";
    private static final int NOTIFICATION_ID = 4101;
    private static final String ACTION_REFRESH = "com.infinityplay.app.download.REFRESH";
    private static final String ACTION_PAUSE = "com.infinityplay.app.download.PAUSE";
    private static final String ACTION_RESUME = "com.infinityplay.app.download.RESUME";
    private static final String ACTION_CANCEL = "com.infinityplay.app.download.CANCEL";
    private static final String EXTRA_ID = "download_id";

    private static final Object DOWNLOADER_LOCK = new Object();
    private static final Object SEASON_QUEUE_LOCK = new Object();
    private static FileDownloader downloader;
    private static volatile DownloadService activeService;
    private static final List<SeasonEntry> seasonQueue = new ArrayList<>();
    private static final List<SeasonEntry> seasonHistory = new ArrayList<>();
    private static final MovieBoxReleaseResolver releaseResolver = new MovieBoxReleaseResolver();
    private static boolean seasonQueueRunning;
    private static boolean seasonQueuePaused;
    private static SeasonEntry activeSeasonEntry;
    private static Context seasonContext;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    static FileDownloader downloader(Context context) {
        synchronized (DOWNLOADER_LOCK) {
            if (downloader == null) {
                downloader = new FileDownloader(
                    context.getApplicationContext(),
                    DownloadService::onDownloadsChanged
                );
            }
            return downloader;
        }
    }

    /** Starts or refreshes the foreground service after the user presses Download. */
    static void keepAlive(Context context) {
        Intent intent = new Intent(context, DownloadService.class).setAction(ACTION_REFRESH);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(intent);
        } else {
            context.startService(intent);
        }
    }

    /** Adds all requested episodes to the native queue so it can progress without the WebView. */
    static int enqueueSeason(
        Context context,
        String subjectId,
        String title,
        String year,
        String posterUrl,
        int season,
        int[] episodes,
        int resolution
    ) {
        List<Integer> ordered = new ArrayList<>();
        Set<Integer> seen = new HashSet<>();
        for (int episode : episodes) {
            if (episode > 0 && seen.add(episode)) ordered.add(episode);
        }
        Collections.sort(ordered);

        synchronized (SEASON_QUEUE_LOCK) {
            seasonContext = context.getApplicationContext();
            for (int episode : ordered) {
                seasonQueue.add(new SeasonEntry(
                    "season-" + System.currentTimeMillis() + "-" + Math.abs((subjectId + season + episode).hashCode()),
                    subjectId,
                    title,
                    year,
                    posterUrl,
                    season,
                    episode,
                    resolution
                ));
            }
            startSeasonWorkerLocked();
        }
        onDownloadsChanged();
        return ordered.size();
    }

    static int clearSeasonQueue() {
        synchronized (SEASON_QUEUE_LOCK) {
            int dropped = seasonQueue.size();
            seasonQueue.clear();
            seasonQueuePaused = false;
            SEASON_QUEUE_LOCK.notifyAll();
            onDownloadsChanged();
            return dropped;
        }
    }

    static boolean pauseSeasonQueue() {
        synchronized (SEASON_QUEUE_LOCK) {
            if (seasonQueuePaused || seasonQueue.isEmpty()) return false;
            seasonQueuePaused = true;
            onDownloadsChanged();
            return true;
        }
    }

    static boolean resumeSeasonQueue() {
        synchronized (SEASON_QUEUE_LOCK) {
            if (!seasonQueuePaused) return false;
            seasonQueuePaused = false;
            SEASON_QUEUE_LOCK.notifyAll();
            startSeasonWorkerLocked();
            onDownloadsChanged();
            return true;
        }
    }

    static boolean removeSeasonQueueItem(String id) {
        synchronized (SEASON_QUEUE_LOCK) {
            for (int index = 0; index < seasonQueue.size(); index++) {
                if (seasonQueue.get(index).id.equals(id)) {
                    seasonQueue.remove(index);
                    if (seasonQueue.isEmpty()) seasonQueuePaused = false;
                    SEASON_QUEUE_LOCK.notifyAll();
                    onDownloadsChanged();
                    return true;
                }
            }
            return false;
        }
    }

    /**
     * Removes an episode that the native season worker owns.  The web layer also stores a copy of
     * each record, but removing only that copy made terminal entries reappear on the next native
     * status refresh.
     */
    static boolean removeSeasonDownload(String id, boolean deleteFile) {
        List<String> downloadIds = new ArrayList<>();
        Context context;
        boolean removed = false;

        synchronized (SEASON_QUEUE_LOCK) {
            for (int index = seasonHistory.size() - 1; index >= 0; index--) {
                SeasonEntry entry = seasonHistory.get(index);
                if (!entry.hasId(id)) continue;
                seasonHistory.remove(index);
                if (entry.downloadId != null) downloadIds.add(entry.downloadId);
                removed = true;
            }

            for (int index = seasonQueue.size() - 1; index >= 0; index--) {
                if (seasonQueue.get(index).hasId(id)) {
                    seasonQueue.remove(index);
                    removed = true;
                }
            }

            if (activeSeasonEntry != null && activeSeasonEntry.hasId(id)) {
                activeSeasonEntry.dismissed = true;
                activeSeasonEntry.deleteFileOnDismiss = deleteFile;
                if (activeSeasonEntry.downloadId != null) downloadIds.add(activeSeasonEntry.downloadId);
                removed = true;
            }

            if (seasonQueue.isEmpty()) seasonQueuePaused = false;
            SEASON_QUEUE_LOCK.notifyAll();
            context = seasonContext;
        }

        if (context != null) {
            for (String downloadId : downloadIds) downloader(context).remove(downloadId, deleteFile);
        }
        if (removed) onDownloadsChanged();
        return removed;
    }

    /** Clears terminal season entries without touching an in-progress episode or queued work. */
    static int clearFinishedSeasonDownloads() {
        synchronized (SEASON_QUEUE_LOCK) {
            int cleared = seasonHistory.size();
            seasonHistory.clear();
            if (cleared > 0) onDownloadsChanged();
            return cleared;
        }
    }

    static QueueStatus seasonQueueStatus() {
        synchronized (SEASON_QUEUE_LOCK) {
            List<QueueItem> items = new ArrayList<>();
            for (SeasonEntry entry : seasonQueue) items.add(new QueueItem(entry));
            return new QueueStatus(items, seasonQueuePaused);
        }
    }

    static List<SeasonDownloadSnapshot> seasonDownloadSnapshots() {
        synchronized (SEASON_QUEUE_LOCK) {
            List<SeasonEntry> entries = new ArrayList<>(seasonHistory);
            if (activeSeasonEntry != null) entries.add(activeSeasonEntry);
            List<SeasonDownloadSnapshot> snapshots = new ArrayList<>();
            for (SeasonEntry entry : entries) {
                if (!entry.dismissed) snapshots.add(snapshot(entry));
            }
            return snapshots;
        }
    }

    private static void startSeasonWorkerLocked() {
        if (seasonQueueRunning || seasonQueue.isEmpty() || seasonQueuePaused) return;
        seasonQueueRunning = true;
        Thread worker = new Thread(DownloadService::runSeasonQueue, "infinityplay-season-downloads");
        worker.start();
    }

    private static void runSeasonQueue() {
        while (true) {
            SeasonEntry entry;
            Context context;
            synchronized (SEASON_QUEUE_LOCK) {
                while (seasonQueuePaused && !seasonQueue.isEmpty()) {
                    try {
                        SEASON_QUEUE_LOCK.wait();
                    } catch (InterruptedException error) {
                        Thread.currentThread().interrupt();
                        seasonQueueRunning = false;
                        return;
                    }
                }
                if (seasonQueue.isEmpty()) {
                    activeSeasonEntry = null;
                    seasonQueueRunning = false;
                    onDownloadsChanged();
                    return;
                }
                entry = seasonQueue.remove(0);
                activeSeasonEntry = entry;
                context = seasonContext;
            }
            onDownloadsChanged();

            try {
                MovieBoxReleaseResolver.Release release = releaseResolver.resolve(
                    entry.subjectId,
                    entry.season,
                    entry.episode,
                    entry.requestedResolution
                );
                entry.url = release.url;
                entry.resourceId = release.resourceId;
                entry.resolution = release.resolution;
                if (entry.dismissed) {
                    entry.state = "cancelled";
                    entry.completedAt = System.currentTimeMillis();
                } else {
                    entry.downloadId = downloader(context).start(release.url, entry.filename(), entry.id);
                    entry.startedAt = System.currentTimeMillis();
                    if (entry.dismissed) {
                        downloader(context).remove(entry.downloadId, entry.deleteFileOnDismiss);
                    }
                    onDownloadsChanged();
                    waitForSeasonDownload(context, entry);
                }
            } catch (Exception error) {
                entry.state = "interrupted";
                entry.failureReason = error.getMessage() == null
                    ? "No downloadable source was found for this episode."
                    : error.getMessage();
                entry.completedAt = System.currentTimeMillis();
            }

            synchronized (SEASON_QUEUE_LOCK) {
                if (!entry.dismissed) seasonHistory.add(entry);
                activeSeasonEntry = null;
            }
            onDownloadsChanged();
        }
    }

    private static void waitForSeasonDownload(Context context, SeasonEntry entry)
        throws InterruptedException {
        while (true) {
            FileDownloader.Job job = downloader(context).status(entry.downloadId);
            if (job == null) {
                entry.state = "cancelled";
                entry.completedAt = System.currentTimeMillis();
                return;
            }
            entry.state = job.state;
            entry.failureReason = job.failureReason;
            if ("completed".equals(job.state) || "cancelled".equals(job.state)
                || "interrupted".equals(job.state)) {
                entry.completedAt = System.currentTimeMillis();
                return;
            }
            Thread.sleep(500);
        }
    }

    private static SeasonDownloadSnapshot snapshot(SeasonEntry entry) {
        FileDownloader.Job job = entry.downloadId == null ? null : downloader(seasonContext).status(entry.downloadId);
        String state = job == null ? entry.state : job.state;
        long received = job == null ? 0 : job.received.get();
        long total = job == null ? 0 : job.total.get();
        String fileUrl = job != null && "completed".equals(state) ? android.net.Uri.fromFile(job.file).toString() : "";
        String reason = job == null ? entry.failureReason : job.failureReason;
        return new SeasonDownloadSnapshot(entry, state, received, total, fileUrl, reason);
    }

    private static void onDownloadsChanged() {
        DownloadService service = activeService;
        if (service != null) service.mainHandler.post(service::refreshNotification);
    }

    static final class QueueItem {
        final String id;
        final String title;
        final String posterUrl;
        final int season;
        final int episode;
        final int resolution;

        QueueItem(SeasonEntry entry) {
            id = entry.id;
            title = entry.title;
            posterUrl = entry.posterUrl;
            season = entry.season;
            episode = entry.episode;
            resolution = entry.requestedResolution;
        }
    }

    static final class QueueStatus {
        final List<QueueItem> items;
        final boolean paused;

        QueueStatus(List<QueueItem> items, boolean paused) {
            this.items = items;
            this.paused = paused;
        }
    }

    static final class SeasonDownloadSnapshot {
        final String id;
        final String url;
        final String resourceId;
        final String title;
        final String year;
        final String posterUrl;
        final String subjectId;
        final int season;
        final int episode;
        final int resolution;
        final String state;
        final long receivedBytes;
        final long totalBytes;
        final String fileUrl;
        final String failureReason;
        final long startedAt;
        final long completedAt;
        final String filename;

        SeasonDownloadSnapshot(
            SeasonEntry entry,
            String state,
            long receivedBytes,
            long totalBytes,
            String fileUrl,
            String failureReason
        ) {
            id = entry.downloadId == null ? entry.id : entry.downloadId;
            url = entry.url;
            resourceId = entry.resourceId;
            title = entry.title;
            year = entry.year;
            posterUrl = entry.posterUrl;
            subjectId = entry.subjectId;
            season = entry.season;
            episode = entry.episode;
            resolution = entry.resolution > 0 ? entry.resolution : entry.requestedResolution;
            this.state = state;
            this.receivedBytes = receivedBytes;
            this.totalBytes = totalBytes;
            this.fileUrl = fileUrl;
            this.failureReason = failureReason;
            this.startedAt = entry.startedAt;
            this.completedAt = entry.completedAt;
            this.filename = entry.filename();
        }
    }

    private static final class SeasonEntry {
        final String id;
        final String subjectId;
        final String title;
        final String year;
        final String posterUrl;
        final int season;
        final int episode;
        final int requestedResolution;
        volatile String downloadId;
        volatile String url = "";
        volatile String resourceId = "";
        volatile int resolution;
        volatile String state = "progressing";
        volatile String failureReason = "";
        volatile long startedAt = System.currentTimeMillis();
        volatile long completedAt;
        volatile boolean dismissed;
        volatile boolean deleteFileOnDismiss;

        SeasonEntry(
            String id,
            String subjectId,
            String title,
            String year,
            String posterUrl,
            int season,
            int episode,
            int requestedResolution
        ) {
            this.id = id;
            this.subjectId = subjectId;
            this.title = title;
            this.year = year;
            this.posterUrl = posterUrl;
            this.season = season;
            this.episode = episode;
            this.requestedResolution = requestedResolution;
        }

        String filename() {
            String quality = resolution > 0 ? String.valueOf(resolution) : "auto";
            return title + "-S" + String.format(java.util.Locale.US, "%02d", season)
                + "E" + String.format(java.util.Locale.US, "%02d", episode)
                + "-" + quality + "p.mp4";
        }

        boolean hasId(String value) {
            return id.equals(value) || (downloadId != null && downloadId.equals(value));
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        activeService = this;
        createChannel();
    }

    @Override
    public int onStartCommand(@Nullable Intent intent, int flags, int startId) {
        String action = intent == null ? ACTION_REFRESH : intent.getAction();
        String id = intent == null ? null : intent.getStringExtra(EXTRA_ID);
        if (id != null) {
            if (ACTION_PAUSE.equals(action)) {
                downloader(this).pause(id);
            } else if (ACTION_RESUME.equals(action)) {
                downloader(this).resume(id);
            } else if (ACTION_CANCEL.equals(action)) {
                downloader(this).cancel(id);
            }
        }
        refreshNotification();
        // Transfers are held in the foreground service; there is no incomplete work to recreate
        // if Android kills the whole process.
        return START_NOT_STICKY;
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "Offline downloads",
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("Progress for InfinityPlay video downloads");
        getSystemService(NotificationManager.class).createNotificationChannel(channel);
    }

    private void refreshNotification() {
        FileDownloader.Job job = downloader(this).activeJob();
        SeasonEntry preparing = currentSeasonEntry();
        if (job == null && preparing == null) {
            stopForeground(STOP_FOREGROUND_REMOVE);
            stopSelf();
            return;
        }

        Notification notification = job == null ? buildPreparingNotification(preparing) : buildNotification(job);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
            );
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
    }

    private static SeasonEntry currentSeasonEntry() {
        synchronized (SEASON_QUEUE_LOCK) {
            return activeSeasonEntry;
        }
    }

    private Notification buildNotification(FileDownloader.Job job) {
        boolean paused = "paused".equals(job.state);
        long total = job.total.get();
        long received = job.received.get();
        int percent = total > 0 ? (int) Math.min(100, (received * 100L) / total) : 0;
        String state = paused ? "Download paused" : "Downloading";
        String detail = total > 0 ? percent + "%" : "Preparing download";

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_sys_download)
            .setContentTitle(state + ": " + job.title)
            .setContentText(detail)
            .setContentIntent(openAppIntent())
            .setOnlyAlertOnce(true)
            .setOngoing(true)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setProgress(total > 0 ? 100 : 0, total > 0 ? percent : 0, total <= 0);

        builder.addAction(
            paused ? android.R.drawable.ic_media_play : android.R.drawable.ic_media_pause,
            paused ? "Resume" : "Pause",
            commandIntent(paused ? ACTION_RESUME : ACTION_PAUSE, job.id)
        );
        builder.addAction(
            android.R.drawable.ic_menu_close_clear_cancel,
            "Cancel",
            commandIntent(ACTION_CANCEL, job.id)
        );
        return builder.build();
    }

    private Notification buildPreparingNotification(SeasonEntry entry) {
        String episode = "S" + String.format(java.util.Locale.US, "%02d", entry.season)
            + "E" + String.format(java.util.Locale.US, "%02d", entry.episode);
        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_sys_download)
            .setContentTitle("Preparing download: " + entry.title)
            .setContentText(episode)
            .setContentIntent(openAppIntent())
            .setOnlyAlertOnce(true)
            .setOngoing(true)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setProgress(0, 0, true)
            .build();
    }

    private PendingIntent openAppIntent() {
        Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
        if (launch == null) launch = new Intent(this, MainActivity.class);
        launch.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(
            this,
            0,
            launch,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    private PendingIntent commandIntent(String action, String id) {
        Intent command = new Intent(this, DownloadService.class)
            .setAction(action)
            .putExtra(EXTRA_ID, id);
        int requestCode = (action + id).hashCode() & 0x7fffffff;
        return PendingIntent.getService(
            this,
            requestCode,
            command,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    @Override
    public void onDestroy() {
        if (activeService == this) activeService = null;
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
