package com.infinityplay.app;

import android.util.Base64;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/**
 * Minimal native MovieBox client used only by the foreground season queue.
 *
 * It resolves one progressive episode immediately before downloading it, rather than accepting a
 * batch of signed URLs from the WebView. Those URLs expire during a long season and the WebView is
 * suspended while the app is backgrounded, so neither approach can keep a season progressing.
 */
final class MovieBoxReleaseResolver {
    static final class Release {
        final String url;
        final String resourceId;
        final int resolution;

        Release(String url, String resourceId, int resolution) {
            this.url = url;
            this.resourceId = resourceId;
            this.resolution = resolution;
        }
    }

    private static final String[] HOSTS = {
        "https://api6.aoneroom.com",
        "https://api5.aoneroom.com",
        "https://api4.aoneroom.com",
        "https://api4sg.aoneroom.com",
        "https://api3.aoneroom.com",
        "https://api6sg.aoneroom.com",
        "https://api.inmoviebox.com"
    };
    private static final String RESOURCE_PATH = "/wefeed-mobile-bff/subject-api/resource/v2";
    private static final String SECRET = "76iRl07s0xSN9jqmEWAt79EBJZulIQIsV64FZr2O";
    private static final int PER_PAGE = 20;

    private final String userAgent;
    private final String clientInfo;
    private final String spoofedIp;
    private String token;
    private int activeHost;

    MovieBoxReleaseResolver() {
        String deviceId = randomHex(32);
        String gaid = UUID.randomUUID().toString();
        userAgent = "com.community.oneroom/50020042 (Linux; U; Android 13; en_US; 2201117TY; "
            + "Build/TQ2A.230405.003; Cronet/135.0.7012.3)";
        clientInfo = "{\"package_name\":\"com.community.oneroom\","
            + "\"version_name\":\"3.0.03.0529.03\",\"version_code\":50020042,"
            + "\"os\":\"android\",\"os_version\":\"13\",\"install_ch\":\"ps\","
            + "\"device_id\":\"" + deviceId + "\",\"install_store\":\"ps\","
            + "\"gaid\":\"" + gaid + "\",\"brand\":\"Redmi\","
            + "\"model\":\"2201117TY\",\"system_language\":\"en\","
            + "\"net\":\"NETWORK_WIFI\",\"region\":\"US\","
            + "\"timezone\":\"Europe/London\",\"sp_code\":\"40401\","
            + "\"X-Play-Mode\":\"2\"}";
        spoofedIp = "103.241." + (10 + (int) (Math.random() * 220)) + "."
            + (10 + (int) (Math.random() * 220));
    }

    synchronized Release resolve(String subjectId, int season, int episode, int requestedResolution)
        throws IOException {
        ensureSession();

        List<Integer> candidates = new ArrayList<>();
        if (requestedResolution > 0) candidates.add(requestedResolution);
        for (int resolution : collectionResolutions(subjectId)) {
            if (!candidates.contains(resolution)) candidates.add(resolution);
        }
        if (candidates.isEmpty()) candidates.add(0);

        for (int resolution : candidates) {
            Release release = findEpisode(subjectId, season, episode, resolution);
            if (release != null) return release;
        }
        throw new IOException("No downloadable source was found for this episode.");
    }

    private void ensureSession() throws IOException {
        if (token != null && !token.isEmpty()) return;
        request("/wefeed-mobile-bff/tab-operating?page=1&tabId=0&version=");
        if (token == null || token.isEmpty()) {
            throw new IOException("MovieBox did not provide a download session.");
        }
    }

    private List<Integer> collectionResolutions(String subjectId) throws IOException {
        JSONObject payload = request(
            RESOURCE_PATH + "?subjectId=" + encode(subjectId) + "&page=1&perPage=" + PER_PAGE
        );
        JSONArray values = payload.optJSONArray("collectionResolutions");
        Set<Integer> found = new HashSet<>();
        if (values != null) {
            for (int index = 0; index < values.length(); index++) {
                int resolution = values.optJSONObject(index) == null
                    ? 0
                    : values.optJSONObject(index).optInt("resolution", 0);
                if (resolution > 0) found.add(resolution);
            }
        }
        List<Integer> result = new ArrayList<>(found);
        Collections.sort(result, Collections.reverseOrder());
        return result;
    }

    private Release findEpisode(String subjectId, int season, int episode, int resolution)
        throws IOException {
        JSONObject first = resourcePage(subjectId, season, episode, 1, resolution);
        Release direct = releaseIn(first.optJSONArray("list"), season, episode);
        if (direct != null) return direct;

        JSONArray firstList = first.optJSONArray("list");
        if (firstList == null || firstList.length() == 0) return null;

        int total = first.optJSONObject("pager") == null
            ? 0
            : first.optJSONObject("pager").optInt("totalCount", 0);
        int low = 2;
        int high = Math.max(1, (int) Math.ceil(total / (double) PER_PAGE));
        long target = rank(season, episode);

        while (low <= high) {
            int page = (low + high) >>> 1;
            JSONObject payload = resourcePage(subjectId, season, episode, page, resolution);
            JSONArray list = payload.optJSONArray("list");
            if (list == null || list.length() == 0) {
                high = page - 1;
                continue;
            }
            Release hit = releaseIn(list, season, episode);
            if (hit != null) return hit;

            JSONObject firstEntry = list.optJSONObject(0);
            JSONObject lastEntry = list.optJSONObject(list.length() - 1);
            long firstRank = rank(firstEntry.optInt("se"), firstEntry.optInt("ep"));
            long lastRank = rank(lastEntry.optInt("se"), lastEntry.optInt("ep"));
            if (target < firstRank) high = page - 1;
            else if (target > lastRank) low = page + 1;
            else return null;
        }
        return null;
    }

    private JSONObject resourcePage(String subjectId, int season, int episode, int page, int resolution)
        throws IOException {
        String path = RESOURCE_PATH
            + "?subjectId=" + encode(subjectId)
            + "&se=" + season
            + "&ep=" + episode
            + "&page=" + page
            + "&perPage=" + PER_PAGE;
        if (resolution > 0) path += "&resolution=" + resolution;
        return request(path);
    }

    private Release releaseIn(JSONArray list, int season, int episode) {
        if (list == null) return null;
        for (int index = 0; index < list.length(); index++) {
            JSONObject entry = list.optJSONObject(index);
            if (entry == null || entry.optInt("se") != season || entry.optInt("ep") != episode) {
                continue;
            }
            String url = entry.optString("resourceLink", "");
            if (url.isEmpty()) return null;
            return new Release(
                url,
                entry.optString("resourceId", ""),
                entry.optInt("resolution", 0)
            );
        }
        return null;
    }

    private JSONObject request(String path) throws IOException {
        IOException lastError = null;
        int start = activeHost;
        for (int attempt = 0; attempt < HOSTS.length; attempt++) {
            int index = (start + attempt) % HOSTS.length;
            HttpURLConnection connection = null;
            try {
                String url = HOSTS[index] + path;
                connection = (HttpURLConnection) new URL(url).openConnection();
                connection.setRequestMethod("GET");
                connection.setConnectTimeout(20_000);
                connection.setReadTimeout(20_000);
                connection.setRequestProperty("user-agent", userAgent);
                connection.setRequestProperty("accept", "application/json");
                connection.setRequestProperty("content-type", "application/json");
                connection.setRequestProperty("connection", "keep-alive");
                long timestamp = System.currentTimeMillis();
                connection.setRequestProperty("x-client-token", clientToken(timestamp));
                connection.setRequestProperty("x-tr-signature", signature(url, timestamp));
                connection.setRequestProperty("x-client-info", clientInfo);
                connection.setRequestProperty("x-client-status", "0");
                connection.setRequestProperty("x-forwarded-for", spoofedIp);
                if (token != null && !token.isEmpty()) {
                    connection.setRequestProperty("authorization", "Bearer " + token);
                }

                int status = connection.getResponseCode();
                captureToken(connection.getHeaderField("x-user"));
                if (status < 200 || status >= 300) {
                    lastError = new IOException("MovieBox host returned HTTP " + status + ".");
                    continue;
                }

                JSONObject root = new JSONObject(readAll(connection.getInputStream()));
                activeHost = index;
                Object data = root.opt("data");
                return data instanceof JSONObject ? (JSONObject) data : root;
            } catch (Exception error) {
                lastError = error instanceof IOException
                    ? (IOException) error
                    : new IOException("MovieBox request failed.", error);
            } finally {
                if (connection != null) connection.disconnect();
            }
        }
        throw lastError == null ? new IOException("Every MovieBox host failed for this request.") : lastError;
    }

    private void captureToken(String value) {
        if (value == null || value.isEmpty()) return;
        try {
            String candidate = new JSONObject(value).optString("token", "");
            if (!candidate.isEmpty()) token = candidate;
        } catch (Exception ignored) {
            // Keep the previous session token when a proxy returns a malformed header.
        }
    }

    private String clientToken(long timestamp) throws IOException {
        String value = String.valueOf(timestamp);
        return value + "," + md5(new StringBuilder(value).reverse().toString());
    }

    private String signature(String url, long timestamp) throws IOException {
        URL parsed = new URL(url);
        String canonicalPath = parsed.getPath();
        String query = parsed.getQuery();
        if (query != null && !query.isEmpty()) {
            String[] parts = query.split("&");
            java.util.Arrays.sort(parts);
            canonicalPath += "?" + join(parts, "&");
        }
        String canonical = "GET\napplication/json\napplication/json\n\n" + timestamp
            + "\n\n" + canonicalPath;
        try {
            Mac mac = Mac.getInstance("HmacMD5");
            mac.init(new SecretKeySpec(secretBytes(), "HmacMD5"));
            String encoded = Base64.encodeToString(
                mac.doFinal(canonical.getBytes(StandardCharsets.UTF_8)),
                Base64.NO_WRAP
            );
            return timestamp + "|2|" + encoded;
        } catch (Exception error) {
            throw new IOException("Could not sign MovieBox request.", error);
        }
    }

    private static byte[] secretBytes() {
        int padding = (4 - (SECRET.length() % 4)) % 4;
        String value = SECRET + repeat("=", padding);
        return Base64.decode(value, Base64.DEFAULT);
    }

    private static String md5(String value) throws IOException {
        try {
            byte[] hash = MessageDigest.getInstance("MD5").digest(value.getBytes(StandardCharsets.UTF_8));
            StringBuilder output = new StringBuilder(hash.length * 2);
            for (byte item : hash) output.append(String.format(Locale.US, "%02x", item & 0xff));
            return output.toString();
        } catch (Exception error) {
            throw new IOException("Could not create MovieBox request token.", error);
        }
    }

    private static String encode(String value) throws IOException {
        return URLEncoder.encode(value, "UTF-8");
    }

    private static long rank(int season, int episode) {
        return season * 100_000L + episode;
    }

    private static String readAll(InputStream stream) throws IOException {
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            StringBuilder output = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) output.append(line);
            return output.toString();
        }
    }

    private static String randomHex(int length) {
        StringBuilder output = new StringBuilder(length);
        for (int index = 0; index < length; index++) {
            output.append(Integer.toHexString((int) (Math.random() * 16)));
        }
        return output.toString();
    }

    private static String repeat(String value, int count) {
        StringBuilder output = new StringBuilder();
        for (int index = 0; index < count; index++) output.append(value);
        return output.toString();
    }

    private static String join(String[] values, String separator) {
        StringBuilder output = new StringBuilder();
        for (int index = 0; index < values.length; index++) {
            if (index > 0) output.append(separator);
            output.append(values[index]);
        }
        return output.toString();
    }
}
