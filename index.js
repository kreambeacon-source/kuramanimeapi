const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const { chromium } = require('playwright');

const app = express();
const PORT = process.env.PORT || 5000;

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(cors());
app.use(express.json());

let browser = null;
const BASE_URL = 'https://v20.kuramanime.ing';
const FALLBACK_VIDEO = "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4";

async function initBrowser() {
    try {
        browser = await chromium.launch({
            headless: true,
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox', 
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--disable-gpu',
                '--window-size=1920,1080',
                '--disable-blink-features=AutomationControlled'
            ]
        });
        console.log("✅ Playwright Browser Siap (Direct JSON Mode)!");
    } catch (error) {
        console.error("❌ Gagal menginisialisasi browser:", error);
    }
}

// Helper: Delay
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Helper: Ubah Slug Kembali ke Path URL Kuramanime
function resolveAnimePath(slug) {
    if (!slug) return '';
    return slug.replace(/__/g, '/');
}

// Helper: Membuat Context dengan Anti-Detection Lanjutan
async function createStealthContext(browserInstance) {
    const context = await browserInstance.newContext({ 
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        viewport: { width: 1920, height: 1080 },
        locale: 'id-ID',
        timezoneId: 'Asia/Jakarta',
        permissions: ['geolocation'],
        extraHTTPHeaders: {
            'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
            'Sec-Ch-Ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
            'Sec-Ch-Ua-Mobile': '?0',
            'Sec-Ch-Ua-Platform': '"Windows"'
        }
    });

    await context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', {
            get: () => false,
        });
        Object.defineProperty(navigator, 'plugins', {
            get: () => [1, 2, 3, 4, 5],
        });
    });

    return context;
}

// ==========================================
// HELPER UTAMA: Fetch JSON Langsung dari Target via Browser Context
// ==========================================
async function fetchKuramaJson(browserInstance, endpointPath) {
    let context = null;
    let page = null;
    try {
        context = await createStealthContext(browserInstance);
        page = await context.newPage();

        // Kunjungi halaman utama dulu untuk bypass/cookie session Cloudflare
        await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
        await delay(1000);

        const targetUrl = `${BASE_URL}${endpointPath}`;
        console.log(`🔍 Fetching JSON API: ${targetUrl}`);

        const jsonData = await page.evaluate(async (url) => {
            try {
                const res = await fetch(url);
                if (!res.ok) return null;
                return await res.json();
            } catch (err) {
                return null;
            }
        }, targetUrl);

        return jsonData;
    } catch (error) {
        console.error("❌ Error fetchKuramaJson:", error.message);
        return null;
    } finally {
        if (page) await page.close().catch(() => {});
        if (context) await context.close().catch(() => {});
    }
}

// ==========================================
// 1. ENDPOINT: Anime Terbaru (/api/latest?page=1)
// ==========================================
app.get('/api/latest', async (req, res) => {
    if (!browser) return res.status(500).json({ success: false, error: "Browser belum siap." });
    const pageNum = req.query.page || 1;

    try {
        const json = await fetchKuramaJson(browser, `/?need_json=true&page=${pageNum}`);
        
        if (json && json.ongoingAnimes && json.ongoingAnimes.data) {
            const rawItems = json.ongoingAnimes.data;
            const latestAnime = rawItems.map(item => {
                const slug = item.slug ? item.slug.replace(/\//g, '__') : '';
                return {
                    id: slug,
                    title: item.title || '',
                    episode: item.latest_episode ? `Ep ${item.latest_episode}` : 'Ep Baru',
                    url: `${BASE_URL}/anime/${item.slug}`,
                    image: item.image_portrait_url || item.image_landscape_url || '',
                    poster: item.image_portrait_url || item.image_landscape_url || '',
                    type: "Ongoing Anime"
                };
            });

            console.log(`✅ Berhasil mengambil ${latestAnime.length} anime ongoing (Halaman ${pageNum}) via JSON!`);
            return res.json({ success: true, page: Number(pageNum), count: latestAnime.length, data: latestAnime });
        }

        res.json({ success: true, page: Number(pageNum), count: 0, data: [] });
    } catch (error) {
        console.error("❌ Error /api/latest:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==========================================
// 1.5 ENDPOINT: Jadwal Rilis (/api/schedule?day=kamis)
// ==========================================
app.get('/api/schedule', async (req, res) => {
    if (!browser) return res.status(500).json({ success: false, error: "Browser belum siap." });
    const dayInput = (req.query.day || 'senin').toLowerCase();

    const dayMap = {
        senin: 'monday', selasa: 'tuesday', rabu: 'wednesday',
        kamis: 'thursday', jumat: 'friday', sabtu: 'saturday', minggu: 'sunday', semua: 'all'
    };
    const scheduledDay = dayMap[dayInput] || 'monday';

    try {
        const json = await fetchKuramaJson(browser, `/schedule?scheduled_day=${scheduledDay}&need_json=true`);
        
        // Membaca dari struktur JSON jadwal yang dikembalikan
        const rawItems = json?.scheduleAnimes?.data || json?.data || [];
        const scheduleAnime = rawItems.map(item => {
            const slug = item.slug ? item.slug.replace(/\//g, '__') : '';
            return {
                id: slug,
                title: item.title || '',
                episode: item.latest_episode ? `Ep ${item.latest_episode}` : 'Jadwal',
                url: `${BASE_URL}/anime/${item.slug}`,
                image: item.image_portrait_url || item.image_landscape_url || '',
                poster: item.image_portrait_url || item.image_landscape_url || ''
            };
        });

        console.log(`✅ Berhasil mengambil ${scheduleAnime.length} jadwal anime hari ${dayInput}!`);
        res.json({ success: true, day: dayInput, count: scheduleAnime.length, data: scheduleAnime });
    } catch (error) {
        console.error("❌ Error /api/schedule:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==========================================
// 1.6 ENDPOINT: Anime Popular Musim Ini (/api/popular?page=1)
// ==========================================
app.get('/api/popular', async (req, res) => {
    if (!browser) return res.status(500).json({ success: false, error: "Browser belum siap." });
    const pageNum = req.query.page || 1;

    try {
        const json = await fetchKuramaJson(browser, `/?need_json=true&page=${pageNum}`);
        const rawItems = json?.topAnimes?.data || json?.ongoingAnimes?.data || [];

        const popularAnime = rawItems.map(item => {
            const slug = item.slug ? item.slug.replace(/\//g, '__') : '';
            return {
                id: slug,
                title: item.title || '',
                episode: 'Popular',
                url: `${BASE_URL}/anime/${item.slug}`,
                image: item.image_portrait_url || item.image_landscape_url || '',
                poster: item.image_portrait_url || item.image_landscape_url || ''
            };
        });

        console.log(`✅ Berhasil mengambil ${popularAnime.length} anime popular!`);
        res.json({ success: true, page: Number(pageNum), count: popularAnime.length, data: popularAnime });
    } catch (error) {
        console.error("❌ Error /api/popular:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==========================================
// 1.7 ENDPOINT: Film Layar Lebar / Movie (/api/movies?page=1)
// ==========================================
app.get('/api/movies', async (req, res) => {
    if (!browser) return res.status(500).json({ success: false, error: "Browser belum siap." });
    const pageNum = req.query.page || 1;

    try {
        const json = await fetchKuramaJson(browser, `/?need_json=true&page=${pageNum}`);
        const rawItems = json?.movieAnimes?.data || [];

        const movies = rawItems.map(item => {
            const slug = item.slug ? item.slug.replace(/\//g, '__') : '';
            return {
                id: slug,
                title: item.title || '',
                episode: 'Movie',
                url: `${BASE_URL}/anime/${item.slug}`,
                image: item.image_portrait_url || item.image_landscape_url || '',
                poster: item.image_portrait_url || item.image_landscape_url || ''
            };
        });

        console.log(`✅ Berhasil mengambil ${movies.length} film layar lebar!`);
        res.json({ success: true, page: Number(pageNum), count: movies.length, data: movies });
    } catch (error) {
        console.error("❌ Error /api/movies:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==========================================
// 1.8 ENDPOINT: Catalog & Advanced Filter (/api/catalog)
// ==========================================
app.get('/api/catalog', async (req, res) => {
    if (!browser) return res.status(500).json({ success: false, error: "Browser belum siap." });
    const { search = '', category = 'all', page: pageNum = 1 } = req.query;

    try {
        let queryPath = `/?need_json=true&page=${pageNum}`;
        if (search) queryPath = `/anime?search=${encodeURIComponent(search)}&need_json=true&page=${pageNum}`;

        const json = await fetchKuramaJson(browser, queryPath);
        const rawItems = json?.ongoingAnimes?.data || json?.data || [];

        const catalogAnime = rawItems.map(item => {
            const slug = item.slug ? item.slug.replace(/\//g, '__') : '';
            return {
                id: slug,
                title: item.title || '',
                episode: 'HD',
                url: `${BASE_URL}/anime/${item.slug}`,
                image: item.image_portrait_url || item.image_landscape_url || '',
                poster: item.image_portrait_url || item.image_landscape_url || ''
            };
        });

        console.log(`✅ Berhasil mengambil ${catalogAnime.length} item katalog!`);
        res.json({ success: true, page: Number(pageNum), count: catalogAnime.length, data: catalogAnime });
    } catch (error) {
        console.error("❌ Error /api/catalog:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==========================================
// 2. ENDPOINT: Detail Anime (/api/detail)
// ==========================================
app.get('/api/detail', async (req, res) => {
    let { id, url } = req.query;
    if (!id && !url) return res.status(400).json({ success: false, error: "Parameter 'id' atau 'url' wajib disertakan!" });

    const animePath = resolveAnimePath(id); 
    const targetUrl = url || `${BASE_URL}/anime/${animePath}`;
    if (!browser) return res.status(500).json({ success: false, error: "Browser belum siap." });

    let context = null;
    let page = null;

    try {
        context = await createStealthContext(browser);
        page = await context.newPage();

        console.log(`🔍 Fetching Detail: ${targetUrl}`);
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
        await delay(1500);

        const detailData = await page.evaluate(() => {
            const title = document.querySelector('.anime__details__title h3, h3, h1')?.innerText.trim() || '';
            const synopsis = document.querySelector('.anime__details__text p, #synopsis')?.innerText.trim() || 'Sinopsis belum tersedia.';
            const genres = Array.from(document.querySelectorAll('.anime__details__widget ul li a, a[href*="/genre/"]')).map(el => el.innerText.trim());
            const coverImage = document.querySelector('.anime__details__pic')?.getAttribute('data-setbg') || document.querySelector('.anime__details__pic img')?.src || '';
            return { title, synopsis, genres: genres.length > 0 ? genres : ["Action", "Fantasy"], coverImage };
        });

        const htmlContent = await page.content();
        const epNumbers = new Set();
        const generalEpRegex = /\/episode\/(\d+)/g;
        let match;
        while ((match = generalEpRegex.exec(htmlContent)) !== null) {
            const num = parseInt(match[1]);
            if (num > 0 && num < 2000) epNumbers.add(num);
        }

        let maxEpisode = epNumbers.size > 0 ? Math.max(...Array.from(epNumbers)) : 1;
        const episodes = [];
        for (let i = 1; i <= maxEpisode; i++) {
            episodes.push({
                number: i, episodeNumber: i, title: `Episode ${i}`,
                url: `${BASE_URL}/anime/${animePath}/episode/${i}`
            });
        }

        res.json({
            success: true,
            data: {
                id: animePath.replace(/\//g, '__'),
                title: detailData.title,
                synopsis: detailData.synopsis,
                genres: detailData.genres,
                coverImage: detailData.coverImage,
                episodesCount: episodes.length,
                episodes
            }
        });
    } catch (error) {
        console.error("❌ Error fetching detail:", error.message);
        res.status(500).json({ success: false, error: error.message });
    } finally {
        if (page) await page.close().catch(() => {});
        if (context) await context.close().catch(() => {});
    }
});

// ==========================================
// 3. ENDPOINT: Video Stream (/api/watch)
// ==========================================
app.get('/api/watch', async (req, res) => {
    let { id, ep, url } = req.query;
    let targetUrl = url;
    if (!targetUrl && id && ep) {
        const animePath = resolveAnimePath(id);
        targetUrl = `${BASE_URL}/anime/${animePath}/episode/${ep}`;
    }

    if (!targetUrl || !browser) {
        return res.json({ success: true, data: { streamUrl: FALLBACK_VIDEO, type: 'mp4' } });
    }

    let context = null;
    let page = null;
    let extractedVideoUrl = null;

    try {
        context = await createStealthContext(browser);
        page = await context.newPage();

        page.on('request', (request) => {
            const reqUrl = request.url();
            const lowerUrl = reqUrl.toLowerCase();
            const isRealVideo = 
                (lowerUrl.includes('cloudflarestorage.com') || lowerUrl.includes('kuramadrive') || 
                 lowerUrl.includes('kdrive') || lowerUrl.includes('horikita') || lowerUrl.includes('amiya') || 
                 lowerUrl.includes('asuna') || lowerUrl.includes('chisato') || lowerUrl.includes('komari') || lowerUrl.includes('.mp4')) &&
                !lowerUrl.includes('/anime/') && !lowerUrl.includes('/episode/') && !lowerUrl.includes('intro');

            if (isRealVideo && !extractedVideoUrl) {
                extractedVideoUrl = reqUrl;
                console.log(`🎯 [SNIFFER MATCH] Direct Link MP4:\n${extractedVideoUrl}\n`);
            }
        });

        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
        await page.waitForSelector('#animeVideoPlayer, video, .plyr', { timeout: 5000 }).catch(() => {});
        await page.click('#animeVideoPlayer, video, .plyr').catch(() => {});
        await delay(2500);

        if (!extractedVideoUrl) {
            extractedVideoUrl = await page.evaluate(() => {
                const video = document.querySelector('video');
                if (video && video.src && !video.src.includes('intro')) return video.src;
                const source = document.querySelector('video source');
                if (source && source.src && !source.src.includes('intro')) return source.src;
                return null;
            });
        }

        res.json({
            success: true,
            data: { streamUrl: extractedVideoUrl || FALLBACK_VIDEO, type: 'mp4' }
        });
    } catch (error) {
        console.error("❌ Error Watch Scraper:", error.message);
        return res.json({ success: true, data: { streamUrl: FALLBACK_VIDEO, type: 'mp4' } });
    } finally {
        if (page) await page.close().catch(() => {});
        if (context) await context.close().catch(() => {});
    }
});

// ==========================================
// 3.5 ENDPOINT: Proxy Video Stream
// ==========================================
app.get('/api/proxy-video', async (req, res) => {
    const videoUrl = req.query.url;
    if (!videoUrl) return res.status(400).send("URL parameter required");

    try {
        const headers = {
            'Referer': BASE_URL,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        };
        if (req.headers.range) headers['Range'] = req.headers.range;

        const response = await fetch(videoUrl, { headers });
        if (!response.ok && response.status !== 206) return res.status(response.status).send("Gagal mengambil stream video");

        res.status(response.status);
        res.setHeader('Content-Type', response.headers.get('content-type') || 'video/mp4');
        res.setHeader('Access-Control-Allow-Origin', '*');
        
        if (response.headers.get('content-length')) res.setHeader('Content-Length', response.headers.get('content-length'));
        if (response.headers.get('content-range')) res.setHeader('Content-Range', response.headers.get('content-range'));
        if (response.headers.get('accept-ranges')) res.setHeader('Accept-Ranges', response.headers.get('accept-ranges'));

        if (response.body) {
            const reader = response.body.getReader();
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                res.write(Buffer.from(value));
            }
            res.end();
        } else {
            const arrayBuffer = Array.from(new Uint8Array(await response.arrayBuffer()));
            res.send(Buffer.from(arrayBuffer));
        }
    } catch (err) {
        console.error("❌ Error Proxy Video:", err.message);
        if (!res.headersSent) res.status(500).send("Proxy Stream Error");
    }
});

// ==========================================
// 4. SOCKET.IO LIVE CHAT
// ==========================================
io.on('connection', (socket) => {
    socket.on('join_room', (roomId) => socket.join(roomId));
    socket.on('send_message', (data) => io.to(data.roomId).emit('receive_message', data));
});

server.listen(PORT, async () => {
    console.log(`🚀 Server Backend AniXp API berjalan di http://localhost:${PORT}`);
    await initBrowser();
});