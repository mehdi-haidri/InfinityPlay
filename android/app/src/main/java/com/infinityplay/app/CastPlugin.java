package com.infinityplay.app;

import android.content.Context;
import android.net.wifi.WifiManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.LinkedHashSet;
import java.util.Set;

/**
 * SSDP discovery for Android.
 *
 * This is the only part of DLNA a WebView cannot do: SSDP is UDP multicast, while everything that
 * follows — reading the device description and posting SOAP actions — is plain HTTP and is handled
 * by the shared TypeScript so both platforms run the same control path.
 *
 * Chromecast is handled by the Google Cast sender in NativePlayerActivity. Keeping SSDP/DLNA in
 * this separate plugin preserves a standards-based fallback for televisions and phones without
 * Google Play Services.
 */
@CapacitorPlugin(name = "CastDiscovery")
public class CastPlugin extends Plugin {

    private static final String SSDP_ADDRESS = "239.255.255.250";
    private static final int SSDP_PORT = 1900;
    private static final String SEARCH_TARGET = "urn:schemas-upnp-org:device:MediaRenderer:1";
    private static final int LISTEN_MS = 4000;

    private CastProxy proxy;

    /**
     * Turns a media URL into one the TV can actually fetch.
     *
     * Most URLs are returned unchanged. A CDN stream is republished through a local server,
     * because that host refuses any client that is not sending the app's own User-Agent.
     */
    @PluginMethod
    public void publish(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("A url is required.");
            return;
        }

        JSObject result = new JSObject();
        if (!CastProxy.needsProxy(url)) {
            result.put("url", url);
            call.resolve(result);
            return;
        }

        try {
            if (proxy == null) proxy = new CastProxy(getContext());
            result.put("url", proxy.publish(url));
            call.resolve(result);
        } catch (Exception error) {
            call.reject("The stream could not be shared: " + error.getMessage());
        }
    }

    /** Publishes a generated WebVTT sidecar that a TV on the LAN can fetch. */
    @PluginMethod
    public void publishText(PluginCall call) {
        String text = call.getString("text");
        if (text == null || text.isEmpty()) {
            call.reject("Subtitle text is required.");
            return;
        }
        try {
            if (proxy == null) proxy = new CastProxy(getContext());
            JSObject result = new JSObject();
            result.put("url", proxy.publishText(text, ".vtt", "text/vtt; charset=utf-8"));
            call.resolve(result);
        } catch (Exception error) {
            call.reject("The subtitles could not be shared: " + error.getMessage());
        }
    }

    /**
     * Performs an HTTP request against a device on the local network.
     *
     * The WebView cannot do this itself. A UPnP control call is a cross-origin POST carrying a
     * `SOAPAction` header, which makes the browser send a preflight `OPTIONS` first — and a
     * television's renderer answers UPnP, not CORS, so the preflight goes unanswered and the whole
     * call fails as "Failed to fetch" before the TV ever sees it. Issued from here there is no
     * origin and no preflight, which is also how the desktop app talks to the same devices.
     */
    @PluginMethod
    public void httpRequest(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("A url is required.");
            return;
        }
        String method = call.getString("method", "GET");
        String body = call.getString("body", "");
        JSObject headers = call.getObject("headers");

        new Thread(() -> {
            HttpURLConnection connection = null;
            try {
                connection = (HttpURLConnection) new URL(url).openConnection();
                connection.setRequestMethod(method);
                connection.setConnectTimeout(8000);
                connection.setReadTimeout(15000);
                if (headers != null) {
                    Iterator<String> names = headers.keys();
                    while (names.hasNext()) {
                        String name = names.next();
                        connection.setRequestProperty(name, headers.optString(name));
                    }
                }
                if (body != null && !body.isEmpty()) {
                    connection.setDoOutput(true);
                    byte[] payload = body.getBytes(StandardCharsets.UTF_8);
                    connection.setFixedLengthStreamingMode(payload.length);
                    try (OutputStream out = connection.getOutputStream()) {
                        out.write(payload);
                    }
                }

                int status = connection.getResponseCode();
                // A SOAP fault arrives as a 500 with a body worth reading, so errors are read too.
                InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
                String text = stream == null ? "" : readAll(stream);

                JSObject result = new JSObject();
                result.put("status", status);
                result.put("body", text);
                call.resolve(result);
            } catch (Exception error) {
                call.reject(error.getMessage() == null ? "The device did not answer." : error.getMessage(), error);
            } finally {
                if (connection != null) connection.disconnect();
            }
        }).start();
    }

    private static String readAll(InputStream stream) throws IOException {
        ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        byte[] chunk = new byte[8192];
        int read;
        while ((read = stream.read(chunk)) != -1) buffer.write(chunk, 0, read);
        return buffer.toString(StandardCharsets.UTF_8.name());
    }

    /** Revokes anything published for the cast that just ended. */
    @PluginMethod
    public void unpublish(PluginCall call) {
        if (proxy != null) proxy.stop();
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        if (proxy != null) proxy.stop();
        super.handleOnDestroy();
    }

    /**
     * Returns the LOCATION URLs of every media renderer that answers. The renderer fetches and
     * parses each description itself.
     */
    @PluginMethod
    public void discover(PluginCall call) {
        new Thread(() -> {
            // Multicast is filtered out by Wi-Fi power saving unless a lock is held.
            WifiManager wifi = (WifiManager) getContext()
                .getApplicationContext()
                .getSystemService(Context.WIFI_SERVICE);
            WifiManager.MulticastLock lock = null;
            if (wifi != null) {
                lock = wifi.createMulticastLock("infinityplay-ssdp");
                lock.setReferenceCounted(true);
                lock.acquire();
            }

            Set<String> locations = new LinkedHashSet<>();
            DatagramSocket socket = null;

            try {
                socket = new DatagramSocket();
                socket.setReuseAddress(true);
                socket.setSoTimeout(700);

                byte[] search = (
                    "M-SEARCH * HTTP/1.1\r\n"
                        + "HOST: " + SSDP_ADDRESS + ":" + SSDP_PORT + "\r\n"
                        + "MAN: \"ssdp:discover\"\r\n"
                        + "MX: 2\r\n"
                        + "ST: " + SEARCH_TARGET + "\r\n\r\n"
                ).getBytes(StandardCharsets.UTF_8);

                InetSocketAddress target = new InetSocketAddress(InetAddress.getByName(SSDP_ADDRESS), SSDP_PORT);
                socket.send(new DatagramPacket(search, search.length, target));

                long deadline = System.currentTimeMillis() + LISTEN_MS;
                boolean resent = false;

                while (System.currentTimeMillis() < deadline) {
                    // A single datagram is routinely dropped on busy Wi-Fi, so the search repeats once.
                    if (!resent && System.currentTimeMillis() > deadline - LISTEN_MS + 900) {
                        socket.send(new DatagramPacket(search, search.length, target));
                        resent = true;
                    }

                    byte[] buffer = new byte[2048];
                    DatagramPacket reply = new DatagramPacket(buffer, buffer.length);
                    try {
                        socket.receive(reply);
                    } catch (IOException timeout) {
                        continue;
                    }

                    String location = locationOf(new String(reply.getData(), 0, reply.getLength(), StandardCharsets.UTF_8));
                    if (location != null) locations.add(location);
                }
            } catch (Exception error) {
                call.reject("SSDP discovery failed: " + error.getMessage());
                return;
            } finally {
                if (socket != null) socket.close();
                if (lock != null && lock.isHeld()) lock.release();
            }

            JSObject result = new JSObject();
            result.put("locations", new JSONArray(locations));
            call.resolve(result);
        }).start();
    }

    private static String locationOf(String response) {
        for (String line : response.split("\r\n")) {
            int split = line.indexOf(':');
            if (split <= 0) continue;
            if (!line.substring(0, split).trim().equalsIgnoreCase("location")) continue;
            String value = line.substring(split + 1).trim();
            if (!value.isEmpty()) return value;
        }
        return null;
    }
}
