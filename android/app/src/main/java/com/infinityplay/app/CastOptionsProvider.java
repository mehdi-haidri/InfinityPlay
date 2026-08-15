package com.infinityplay.app;

import android.content.Context;

import com.google.android.gms.cast.CastMediaControlIntent;
import com.google.android.gms.cast.framework.CastOptions;
import com.google.android.gms.cast.framework.OptionsProvider;
import com.google.android.gms.cast.framework.SessionProvider;
import com.google.android.gms.cast.framework.media.CastMediaOptions;
import com.google.android.gms.cast.framework.media.NotificationOptions;

import java.util.List;

/** Google Cast sender configuration using Google's default media receiver. */
public final class CastOptionsProvider implements OptionsProvider {
    @Override
    public CastOptions getCastOptions(Context appContext) {
        NotificationOptions notifications = new NotificationOptions.Builder()
            .setTargetActivityClassName(MainActivity.class.getName())
            .build();
        CastMediaOptions media = new CastMediaOptions.Builder()
            .setNotificationOptions(notifications)
            .build();
        return new CastOptions.Builder()
            .setReceiverApplicationId(CastMediaControlIntent.DEFAULT_MEDIA_RECEIVER_APPLICATION_ID)
            .setCastMediaOptions(media)
            .build();
    }

    @Override
    public List<SessionProvider> getAdditionalSessionProviders(Context appContext) {
        return null;
    }
}
