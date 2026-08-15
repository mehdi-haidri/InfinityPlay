package com.infinityplay.app;

import android.content.Context;
import android.net.wifi.WifiManager;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * A short-lived LAN HTTP server that fetches a stream on a TV's behalf.
 *
 * The stream CDN answers 428 to any client that is not sending the app's substitute User-Agent, so
 * a renderer handed the signed URL directly gets an error page instead of video. The phone fetches
 * with the right headers and passes the bytes on. Range and HEAD are mirrored from upstream rather
 * than invented, because a renderer told the wrong length stops.
 *
 * This mirrors src/main/media-server.ts, which does the same job for the desktop app.
 */
final class CastProxy {

    private static final String STREAM_USER_AGENT =
        "com.community.oneroom/50020042 (Linux; U; Android 13; en_US; 2201117TY; "
            + "Build/TQ2A.230405.003; Cronet/135.0.7012.3)";

    private static final int MAX_REDIRECTS = 5;

    /** token -> upstream URL. Cleared when the cast stops. */
    private final Map<String, String> published = new HashMap<>();
    /** Generated sidecars, principally WebVTT subtitles. */
    private final Map<String, PublishedText> publishedText = new HashMap<>();
    private final Context context;

    private ServerSocket server;
    private ExecutorService workers;
    private WifiManager.MulticastLock wifiLock;
    private String origin;

    CastProxy(Context context) {
        this.context = context.getApplicationContext();
    }

    /** True when a URL points at a host that refuses ordinary clients. */
    static boolean needsProxy(String url) {
        try {
            return new URL(url).getHost().endsWith("hakunaymatata.com");
        } catch (Exception malformed) {
            return false;
        }
    }

    /** Returns a LAN URL the TV can fetch, serving the given URL behind an unguessable token. */
    synchronized String publish(String url) throws IOException {
        start();
        String token = UUID.randomUUID().toString() + extensionOf(url);
        published.put(token, url);
        return origin + "/" + token;
    }

    synchronized String publishText(String text, String extension, String contentType) throws IOException {
        start();
        String safeExtension = extension != null && extension.matches("\\.[A-Za-z0-9]+") ? extension : ".txt";
        String token = UUID.randomUUID().toString() + safeExtension;
        publishedText.put(token, new PublishedText(text.getBytes(StandardCharsets.UTF_8), contentType));
        return origin + "/" + token;
    }

    /** Revokes everything published and closes the server. */
    synchronized void stop() {
        published.clear();
        publishedText.clear();
        if (server != null) {
            try {
                server.close();
            } catch (IOException ignored) {
                // Already closed.
            }
            server = null;
        }
        if (workers != null) {
            workers.shutdownNow();
            workers = null;
        }
        if (wifiLock != null && wifiLock.isHeld()) {
            wifiLock.release();
            wifiLock = null;
        }
        origin = null;
    }

    private void start() throws IOException {
        if (server != null && origin != null) return;

        String address = lanAddress();
        if (address == null) throw new IOException("No network connection was found to share this stream over.");

        // Port 0 lets the system pick a free one; the TV is told the full URL anyway.
        server = new ServerSocket();
        server.setReuseAddress(true);
        server.bind(new InetSocketAddress(address, 0));
        origin = "http://" + address + ":" + server.getLocalPort();

        // Wi-Fi power saving can drop inbound connections from the TV while the screen is off.
        WifiManager wifi = (WifiManager) context.getSystemService(Context.WIFI_SERVICE);
        if (wifi != null) {
            wifiLock = wifi.createMulticastLock("infinityplay-cast-proxy");
            wifiLock.setReferenceCounted(true);
            wifiLock.acquire();
        }

        // TVs open several ranged connections at once while buffering and seeking.
        workers = Executors.newCachedThreadPool();
        final ServerSocket listening = server;
        new Thread(() -> {
            while (!listening.isClosed()) {
                try {
                    Socket client = listening.accept();
                    ExecutorService pool = workers;
                    if (pool == null) {
                        client.close();
                        break;
                    }
                    pool.execute(() -> handle(client));
                } catch (IOException stopped) {
                    break;
                }
            }
        }).start();
    }

    private void handle(Socket client) {
        try {
            InputStream in = client.getInputStream();
            OutputStream out = client.getOutputStream();

            String request = readHead(in);
            if (request.isEmpty()) return;

            String[] lines = request.split("\r\n");
            String[] parts = lines[0].split(" ");
            if (parts.length < 2) {
                write(out, "HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                return;
            }

            String method = parts[0].toUpperCase(Locale.US);
            String token = parts[1].replaceAll("^/+", "").split("\\?")[0];
            String range = headerOf(lines, "range");

            String upstream;
            PublishedText text;
            synchronized (this) {
                upstream = published.get(token);
                text = publishedText.get(token);
            }
            if (text != null) {
                serveText(text, method, range, out);
                return;
            }
            if (upstream == null) {
                write(out, "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                return;
            }

            relay(upstream, method, range, out, 0);
        } catch (Exception dropped) {
            // A TV that abandons a range request mid-transfer is normal, not an error worth keeping.
        } finally {
            try {
                client.close();
            } catch (IOException ignored) {
                // Already closed.
            }
        }
    }

    private void serveText(PublishedText text, String method, String range, OutputStream out) throws IOException {
        int size = text.body.length;
        int start = 0;
        int end = Math.max(0, size - 1);
        int status = 200;
        if (range != null) {
            java.util.regex.Matcher match = java.util.regex.Pattern.compile("bytes=(\\d*)-(\\d*)").matcher(range);
            if (match.find()) {
                if (!match.group(1).isEmpty()) start = Integer.parseInt(match.group(1));
                if (!match.group(2).isEmpty()) end = Math.min(Integer.parseInt(match.group(2)), size - 1);
                status = 206;
            }
        }
        if (start >= size || end < start) {
            write(out, "HTTP/1.1 416 Range Not Satisfiable\r\nContent-Range: bytes */" + size + "\r\nConnection: close\r\n\r\n");
            return;
        }
        StringBuilder head = new StringBuilder(status == 206 ? "HTTP/1.1 206 Partial Content\r\n" : "HTTP/1.1 200 OK\r\n");
        head.append("Content-Type: ").append(text.contentType).append("\r\n")
            .append("Content-Length: ").append(end - start + 1).append("\r\n")
            .append("Accept-Ranges: bytes\r\n");
        if (status == 206) head.append("Content-Range: bytes ").append(start).append('-').append(end).append('/').append(size).append("\r\n");
        head.append("Connection: close\r\n\r\n");
        write(out, head.toString());
        if (!"HEAD".equals(method)) {
            out.write(text.body, start, end - start + 1);
            out.flush();
        }
    }

    private static final class PublishedText {
        final byte[] body;
        final String contentType;

        PublishedText(byte[] body, String contentType) {
            this.body = body;
            this.contentType = contentType == null || contentType.isEmpty() ? "text/plain; charset=utf-8" : contentType;
        }
    }

    private void relay(String target, String method, String range, OutputStream out, int hop) throws IOException {
        if (hop > MAX_REDIRECTS) {
            write(out, "HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
            return;
        }

        HttpURLConnection connection = (HttpURLConnection) new URL(target).openConnection();
        // Signed CDN URLs redirect often, and a TV handed a 302 is back where it started, so the
        // hop is followed here where the right headers can be re-sent.
        connection.setInstanceFollowRedirects(false);
        connection.setRequestMethod("HEAD".equals(method) ? "HEAD" : "GET");
        connection.setRequestProperty("User-Agent", STREAM_USER_AGENT);
        connection.setRequestProperty("Accept", "*/*");
        if (range != null) connection.setRequestProperty("Range", range);
        connection.setConnectTimeout(15000);
        connection.setReadTimeout(30000);

        int status = connection.getResponseCode();
        if (status >= 300 && status < 400) {
            String location = connection.getHeaderField("Location");
            connection.disconnect();
            if (location == null) {
                write(out, "HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                return;
            }
            relay(new URL(new URL(target), location).toString(), method, range, out, hop + 1);
            return;
        }

        StringBuilder head = new StringBuilder("HTTP/1.1 ")
            .append(status)
            .append(' ')
            .append(status == 206 ? "Partial Content" : status == 200 ? "OK" : "Error")
            .append("\r\n");

        // Copied from upstream, never invented: these are what decide whether the TV starts and seeks.
        appendHeader(head, connection, "Content-Type", "content-type");
        appendHeader(head, connection, "Content-Length", "content-length");
        appendHeader(head, connection, "Content-Range", "content-range");
        if (connection.getHeaderField("Accept-Ranges") == null) {
            head.append("Accept-Ranges: bytes\r\n");
        } else {
            appendHeader(head, connection, "Accept-Ranges", "accept-ranges");
        }
        head.append("Connection: close\r\n\r\n");
        write(out, head.toString());

        if ("HEAD".equals(method)) {
            connection.disconnect();
            return;
        }

        try (InputStream body = status >= 400 ? connection.getErrorStream() : connection.getInputStream()) {
            if (body == null) return;
            byte[] buffer = new byte[64 * 1024];
            int read;
            while ((read = body.read(buffer)) != -1) {
                out.write(buffer, 0, read);
            }
            out.flush();
        } finally {
            connection.disconnect();
        }
    }

    private static void appendHeader(StringBuilder head, HttpURLConnection connection, String name, String field) {
        String value = connection.getHeaderField(field);
        if (value != null) head.append(name).append(": ").append(value).append("\r\n");
    }

    private static void write(OutputStream out, String text) throws IOException {
        out.write(text.getBytes(StandardCharsets.UTF_8));
        out.flush();
    }

    private static String readHead(InputStream in) throws IOException {
        StringBuilder head = new StringBuilder();
        int value;
        while ((value = in.read()) != -1) {
            head.append((char) value);
            int length = head.length();
            if (length >= 4 && head.charAt(length - 4) == '\r' && head.charAt(length - 3) == '\n'
                && head.charAt(length - 2) == '\r' && head.charAt(length - 1) == '\n') {
                break;
            }
            if (length > 16384) break;
        }
        return head.toString();
    }

    private static String headerOf(String[] lines, String name) {
        for (int index = 1; index < lines.length; index++) {
            int split = lines[index].indexOf(':');
            if (split <= 0) continue;
            if (!lines[index].substring(0, split).trim().equalsIgnoreCase(name)) continue;
            return lines[index].substring(split + 1).trim();
        }
        return null;
    }

    /** The extension a renderer should see, so it can guess the container before reading a byte. */
    private static String extensionOf(String url) {
        String path = url.split("\\?")[0].toLowerCase(Locale.US);
        for (String extension : new String[] { ".mp4", ".m4v", ".mkv", ".webm", ".mov", ".m3u8", ".mpd" }) {
            if (path.endsWith(extension)) return extension;
        }
        return ".mp4";
    }

    /** The address a TV on the same network can reach. */
    private static String lanAddress() {
        try {
            List<NetworkInterface> interfaces = Collections.list(NetworkInterface.getNetworkInterfaces());
            for (NetworkInterface item : interfaces) {
                if (!item.isUp() || item.isLoopback()) continue;
                for (InetAddress address : Collections.list(item.getInetAddresses())) {
                    if (address.isLoopbackAddress() || address.getHostAddress() == null) continue;
                    if (address.getHostAddress().indexOf(':') >= 0) continue;
                    return address.getHostAddress();
                }
            }
        } catch (Exception unavailable) {
            return null;
        }
        return null;
    }
}
