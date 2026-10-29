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
                '--window-size=1920,1080'
            ]
        });
        console.log("✅ Playwright Browser Siap!");
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

// ==========================================
// 1. ENDPOINT: Anime Terbaru (/api/latest?page=1)
// ==========================================
app.get('/api/latest', async (req, res) => {
    if (!browser) return res.status(500).json({ success: false, error: "Browser belum siap." });

    let context = null;
    let page = null;
    const pageNum = req.query.page || 1;

    try {
        context = await browser.newContext({ 
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            viewport: { width: 1920, height: 1080 },
            deviceScaleFactor: 1,
            bypassCSP: true,
            javaScriptEnabled: true
        });
        page = await context.newPage();

        console.log(`🔍 Fetching Rilis Terbaru Halaman ${pageNum}...`);
        
        const TARGET_ONGOING_URL = `${BASE_URL}/quick/ongoing?order_by=updated&page=${pageNum}`;
        
        await page.goto(TARGET_ONGOING_URL, { waitUntil: 'domcontentloaded', timeout: 25000 });
        await page.waitForSelector('.product__item, .col-6', { timeout: 6000 }).catch(() => {});

        const latestAnime = await page.evaluate(() => {
            const items = [];
            document.querySelectorAll('.product__item').forEach((el) => {
                const linkEl = el.querySelector('a[href*="/anime/"]');
                const picEl = el.querySelector('.product__item__pic');
                const titleEl = el.querySelector('.product__item__text h5 a') || el.querySelector('h5 a') || el.querySelector('h5');
                const epEl = el.querySelector('.ep') || el.querySelector('.product__item__pic div') || el.querySelector('.badge');

                const rawUrl = linkEl ? linkEl.href : '';
                const title = titleEl ? titleEl.innerText.trim() : '';
                
                let image = picEl ? picEl.getAttribute('data-setbg') : '';
                if (!image && picEl) {
                    const imgInside = picEl.querySelector('img');
                    if (imgInside) image = imgInside.src || imgInside.getAttribute('data-src') || '';
                }

                const episode = epEl ? epEl.innerText.trim() : 'Ep Baru';

                if (title && rawUrl) {
                    let clean = rawUrl.replace(/\/$/, '');
                    if (clean.includes('/episode/')) clean = clean.split('/episode/')[0];
                    const parts = clean.split('/anime/');
                    const slug = parts.length > 1 ? parts[1].replace(/\//g, '__') : '';

                    items.push({
                        id: slug,
                        title,
                        episode,
                        url: rawUrl,
                        image: image || '',
                        poster: image || '',
                        type: "Ongoing Anime"
                    });
                }
            });
            return items;
        });

        console.log(`✅ Berhasil mengambil ${latestAnime.length} anime ongoing (Halaman ${pageNum})!`);
        res.json({ success: true, page: Number(pageNum), count: latestAnime.length, data: latestAnime });
    } catch (error) {
        console.error("❌ Error /api/latest:", error.message);
        res.status(500).json({ success: false, error: error.message });
    } finally {
        if (page) await page.close().catch(() => {});
        if (context) await context.close().catch(() => {});
    }
});

// ==========================================
// 1.5 ENDPOINT: Jadwal Rilis (/api/schedule?day=kamis)
// ==========================================
app.get('/api/schedule', async (req, res) => {
    if (!browser) return res.status(500).json({ success: false, error: "Browser belum siap." });

    let context = null;
    let page = null;
    const dayInput = (req.query.day || 'senin').toLowerCase();

    const dayMap = {
        senin: 'monday',
        selasa: 'tuesday',
        rabu: 'wednesday',
        kamis: 'thursday',
        jumat: 'friday',
        sabtu: 'saturday',
        minggu: 'sunday',
        semua: 'all'
    };

    const scheduledDay = dayMap[dayInput] || 'monday';

    try {
        context = await browser.newContext({ 
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            viewport: { width: 1920, height: 1080 }
        });
        page = await context.newPage();

        console.log(`🔍 Fetching Jadwal Rilis Hari: ${dayInput} (${scheduledDay})...`);
        
        const TARGET_SCHEDULE_URL = `${BASE_URL}/schedule?scheduled_day=${scheduledDay}`;
        
        await page.goto(TARGET_SCHEDULE_URL, { waitUntil: 'domcontentloaded', timeout: 25000 });
        await page.waitForSelector('.product__item, .col-6', { timeout: 6000 }).catch(() => {});

        const scheduleAnime = await page.evaluate(() => {
            const items = [];
            document.querySelectorAll('.product__item').forEach((el) => {
                const linkEl = el.querySelector('a[href*="/anime/"]');
                const picEl = el.querySelector('.product__item__pic');
                const titleEl = el.querySelector('.product__item__text h5 a') || el.querySelector('h5 a') || el.querySelector('h5');
                const epEl = el.querySelector('.ep') || el.querySelector('.product__item__pic div') || el.querySelector('.badge');

                const rawUrl = linkEl ? linkEl.href : '';
                const title = titleEl ? titleEl.innerText.trim() : '';
                
                let image = picEl ? picEl.getAttribute('data-setbg') : '';
                if (!image && picEl) {
                    const imgInside = picEl.querySelector('img');
                    if (imgInside) image = imgInside.src || imgInside.getAttribute('data-src') || '';
                }

                const episode = epEl ? epEl.innerText.trim() : 'Ep Baru';

                if (title && rawUrl) {
                    let clean = rawUrl.replace(/\/$/, '');
                    if (clean.includes('/episode/')) clean = clean.split('/episode/')[0];
                    const parts = clean.split('/anime/');
                    const slug = parts.length > 1 ? parts[1].replace(/\//g, '__') : '';

                    items.push({
                        id: slug,
                        title,
                        episode,
                        url: rawUrl,
                        image: image || '',
                        poster: image || ''
                    });
                }
            });
            return items;
        });

        console.log(`✅ Berhasil mengambil ${scheduleAnime.length} jadwal anime untuk hari ${dayInput}!`);
        res.json({ success: true, day: dayInput, count: scheduleAnime.length, data: scheduleAnime });
    } catch (error) {
        console.error("❌ Error /api/schedule:", error.message);
        res.status(500).json({ success: false, error: error.message });
    } finally {
        if (page) await page.close().catch(() => {});
        if (context) await context.close().catch(() => {});
    }
});

// ==========================================
// 1.6 ENDPOINT: Anime Popular Musim Ini (/api/popular?page=1)
// ==========================================
app.get('/api/popular', async (req, res) => {
    if (!browser) return res.status(500).json({ success: false, error: "Browser belum siap." });

    let context = null;
    let page = null;
    const pageNum = req.query.page || 1;

    try {
        context = await browser.newContext({ 
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            viewport: { width: 1920, height: 1080 }
        });
        page = await context.newPage();

        console.log(`🔍 Fetching Popular Musim Ini Halaman ${pageNum}...`);
        const TARGET_URL = `${BASE_URL}/properties/season/summer-2026?order_by=most_viewed&page=${pageNum}`;
        
        await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 25000 });
        await page.waitForSelector('.product__item, .col-6', { timeout: 6000 }).catch(() => {});

        const popularAnime = await page.evaluate(() => {
            const items = [];
            document.querySelectorAll('.product__item').forEach((el) => {
                const linkEl = el.querySelector('a[href*="/anime/"]');
                const picEl = el.querySelector('.product__item__pic');
                const titleEl = el.querySelector('.product__item__text h5 a') || el.querySelector('h5 a') || el.querySelector('h5');
                const epEl = el.querySelector('.ep') || el.querySelector('.product__item__pic div') || el.querySelector('.badge');

                const rawUrl = linkEl ? linkEl.href : '';
                const title = titleEl ? titleEl.innerText.trim() : '';
                
                let image = picEl ? picEl.getAttribute('data-setbg') : '';
                if (!image && picEl) {
                    const imgInside = picEl.querySelector('img');
                    if (imgInside) image = imgInside.src || imgInside.getAttribute('data-src') || '';
                }

                const episode = epEl ? epEl.innerText.trim() : 'Popular';

                if (title && rawUrl) {
                    let clean = rawUrl.replace(/\/$/, '');
                    if (clean.includes('/episode/')) clean = clean.split('/episode/')[0];
                    const parts = clean.split('/anime/');
                    const slug = parts.length > 1 ? parts[1].replace(/\//g, '__') : '';

                    items.push({
                        id: slug,
                        title,
                        episode,
                        url: rawUrl,
                        image: image || '',
                        poster: image || ''
                    });
                }
            });
            return items;
        });

        console.log(`✅ Berhasil mengambil ${popularAnime.length} anime popular (Halaman ${pageNum})!`);
        res.json({ success: true, page: Number(pageNum), count: popularAnime.length, data: popularAnime });
    } catch (error) {
        console.error("❌ Error /api/popular:", error.message);
        res.status(500).json({ success: false, error: error.message });
    } finally {
        if (page) await page.close().catch(() => {});
        if (context) await context.close().catch(() => {});
    }
});

// ==========================================
// 1.7 ENDPOINT: Film Layar Lebar / Movie (/api/movies?page=1)
// ==========================================
app.get('/api/movies', async (req, res) => {
    if (!browser) return res.status(500).json({ success: false, error: "Browser belum siap." });

    let context = null;
    let page = null;
    const pageNum = req.query.page || 1;

    try {
        context = await browser.newContext({ 
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            viewport: { width: 1920, height: 1080 }
        });
        page = await context.newPage();

        console.log(`🔍 Fetching Film Layar Lebar Halaman ${pageNum}...`);
        const TARGET_URL = `${BASE_URL}/quick/movie?order_by=updated&page=${pageNum}`;
        
        await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 25000 });
        await page.waitForSelector('.product__item, .col-6', { timeout: 6000 }).catch(() => {});

        const movies = await page.evaluate(() => {
            const items = [];
            document.querySelectorAll('.product__item').forEach((el) => {
                const linkEl = el.querySelector('a[href*="/anime/"]');
                const picEl = el.querySelector('.product__item__pic');
                const titleEl = el.querySelector('.product__item__text h5 a') || el.querySelector('h5 a') || el.querySelector('h5');
                const epEl = el.querySelector('.ep') || el.querySelector('.product__item__pic div') || el.querySelector('.badge');

                const rawUrl = linkEl ? linkEl.href : '';
                const title = titleEl ? titleEl.innerText.trim() : '';
                
                let image = picEl ? picEl.getAttribute('data-setbg') : '';
                if (!image && picEl) {
                    const imgInside = picEl.querySelector('img');
                    if (imgInside) image = imgInside.src || imgInside.getAttribute('data-src') || '';
                }

                const episode = epEl ? epEl.innerText.trim() : 'Movie';

                if (title && rawUrl) {
                    let clean = rawUrl.replace(/\/$/, '');
                    if (clean.includes('/episode/')) clean = clean.split('/episode/')[0];
                    const parts = clean.split('/anime/');
                    const slug = parts.length > 1 ? parts[1].replace(/\//g, '__') : '';

                    items.push({
                        id: slug,
                        title,
                        episode,
                        url: rawUrl,
                        image: image || '',
                        poster: image || ''
                    });
                }
            });
            return items;
        });

        console.log(`✅ Berhasil mengambil ${movies.length} film layar lebar (Halaman ${pageNum})!`);
        res.json({ success: true, page: Number(pageNum), count: movies.length, data: movies });
    } catch (error) {
        console.error("❌ Error /api/movies:", error.message);
        res.status(500).json({ success: false, error: error.message });
    } finally {
        if (page) await page.close().catch(() => {});
        if (context) await context.close().catch(() => {});
    }
});

// ==========================================
// 1.8 ENDPOINT: Catalog & Advanced Filter (/api/catalog)
// ==========================================
app.get('/api/catalog', async (req, res) => {
    if (!browser) return res.status(500).json({ success: false, error: "Browser belum siap." });

    let context = null;
    let page = null;
    
    const { 
        search = '',          
        category = 'all',     
        property_type = '',   
        property_slug = '',   
        order_by = 'ascending',
        page: pageNum = 1 
    } = req.query;

    try {
        context = await browser.newContext({ 
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            viewport: { width: 1920, height: 1080 }
        });
        page = await context.newPage();

        let TARGET_URL = `${BASE_URL}/anime?order_by=${order_by}&page=${pageNum}`;

        if (search && search.trim() !== '') {
            TARGET_URL = `${BASE_URL}/anime?search=${encodeURIComponent(search.trim())}&page=${pageNum}`;
        }
        else if (property_type && property_slug) {
            TARGET_URL = `${BASE_URL}/properties/${property_type}/${property_slug}?order_by=${order_by}&page=${pageNum}`;
        } 
        else if (category !== 'all') {
            TARGET_URL = `${BASE_URL}/quick/${category}?order_by=${order_by}&page=${pageNum}`;
        }

        console.log(`🔍 Fetching Catalog URL: ${TARGET_URL}`);
        
        await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 25000 });
        await page.waitForSelector('.product__item, .col-6', { timeout: 6000 }).catch(() => {});

        const catalogAnime = await page.evaluate(() => {
            const items = [];
            document.querySelectorAll('.product__item').forEach((el) => {
                const linkEl = el.querySelector('a[href*="/anime/"]');
                const picEl = el.querySelector('.product__item__pic');
                const titleEl = el.querySelector('.product__item__text h5 a') || el.querySelector('h5 a') || el.querySelector('h5');
                const epEl = el.querySelector('.ep') || el.querySelector('.product__item__pic div') || el.querySelector('.badge');

                const rawUrl = linkEl ? linkEl.href : '';
                const title = titleEl ? titleEl.innerText.trim() : '';
                
                let image = picEl ? picEl.getAttribute('data-setbg') : '';
                if (!image && picEl) {
                    const imgInside = picEl.querySelector('img');
                    if (imgInside) image = imgInside.src || imgInside.getAttribute('data-src') || '';
                }

                const episode = epEl ? epEl.innerText.trim() : 'HD';

                if (title && rawUrl) {
                    let clean = rawUrl.replace(/\/$/, '');
                    if (clean.includes('/episode/')) clean = clean.split('/episode/')[0];
                    const parts = clean.split('/anime/');
                    const slug = parts.length > 1 ? parts[1].replace(/\//g, '__') : '';

                    items.push({
                        id: slug,
                        title,
                        episode,
                        url: rawUrl,
                        image: image || '',
                        poster: image || ''
                    });
                }
            });
            return items;
        });

        console.log(`✅ Berhasil mengambil ${catalogAnime.length} item katalog (Halaman ${pageNum})!`);
        res.json({ success: true, page: Number(pageNum), count: catalogAnime.length, data: catalogAnime });
    } catch (error) {
        console.error("❌ Error /api/catalog:", error.message);
        res.status(500).json({ success: false, error: error.message });
    } finally {
        if (page) await page.close().catch(() => {});
        if (context) await context.close().catch(() => {});
    }
});

// ==========================================
// 2. ENDPOINT: Detail Anime (/api/detail) — [SMART DETECT EPISODES]
// ==========================================
app.get('/api/detail', async (req, res) => {
    let { id, url } = req.query;

    if (!id && !url) {
        return res.status(400).json({ success: false, error: "Parameter 'id' atau 'url' wajib disertakan!" });
    }

    const animePath = resolveAnimePath(id); 
    const targetUrl = url || `${BASE_URL}/anime/${animePath}`;

    if (!browser) return res.status(500).json({ success: false, error: "Browser belum siap." });

    let context = null;
    let page = null;

    try {
        context = await browser.newContext({ 
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            viewport: { width: 1920, height: 1080 }
        });
        page = await context.newPage();

        console.log(`🔍 Fetching Detail: ${targetUrl}`);
        
        try {
            await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
        } catch (e) {
            console.warn("⚠️ Timeout loading page, proceeding with DOM content.");
        }

        await delay(1500);

        const detailData = await page.evaluate(() => {
            const title = document.querySelector('.anime__details__title h3, h3, h1')?.innerText.trim() || '';
            const synopsis = document.querySelector('.anime__details__text p, #synopsis')?.innerText.trim() || 'Sinopsis belum tersedia.';
            const genres = Array.from(document.querySelectorAll('.anime__details__widget ul li a, a[href*="/genre/"]')).map(el => el.innerText.trim());
            const coverImage = document.querySelector('.anime__details__pic')?.getAttribute('data-setbg') || document.querySelector('.anime__details__pic img')?.src || '';

            return {
                title,
                synopsis,
                genres: genres.length > 0 ? genres : ["Action", "Fantasy"],
                coverImage
            };
        });

        const htmlContent = await page.content();
        const epNumbers = new Set();

        const generalEpRegex = /\/episode\/(\d+)/g;
        let match;
        while ((match = generalEpRegex.exec(htmlContent)) !== null) {
            const num = parseInt(match[1]);
            if (num > 0 && num < 2000) {
                epNumbers.add(num);
            }
        }

        let maxEpisode = epNumbers.size > 0 ? Math.max(...Array.from(epNumbers)) : 1;

        console.log(`📊 Total Episode Terdeteksi untuk [${animePath}]: ${maxEpisode} Episode (1 s/d ${maxEpisode})`);

        const episodes = [];
        for (let i = 1; i <= maxEpisode; i++) {
            episodes.push({
                number: i,
                episodeNumber: i,
                title: `Episode ${i}`,
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
        context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            viewport: { width: 1920, height: 1080 },
            extraHTTPHeaders: { 'Referer': BASE_URL }
        });

        page = await context.newPage();

        page.on('request', (request) => {
            const reqUrl = request.url();
            const lowerUrl = reqUrl.toLowerCase();

            const isRealVideo = 
                (lowerUrl.includes('cloudflarestorage.com') || 
                 lowerUrl.includes('kuramadrive') || 
                 lowerUrl.includes('kdrive') || 
                 lowerUrl.includes('horikita') || 
                 lowerUrl.includes('amiya') || 
                 lowerUrl.includes('asuna') || 
                 lowerUrl.includes('chisato') || 
                 lowerUrl.includes('komari') || 
                 lowerUrl.includes('.mp4')) &&
                !lowerUrl.includes('/anime/') &&
                !lowerUrl.includes('/episode/') &&
                !lowerUrl.includes('intro') &&
                !lowerUrl.includes('promo');

            if (isRealVideo && !extractedVideoUrl) {
                extractedVideoUrl = reqUrl;
                console.log(`🎯 [SNIFFER MATCH] Direct Link MP4 Ditemukan:\n${extractedVideoUrl}\n`);
            }
        });

        console.log(`🎬 Scraper Mengunjungi Episode: ${targetUrl}`);
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

        if (extractedVideoUrl) {
            return res.json({
                success: true,
                data: {
                    streamUrl: extractedVideoUrl,
                    type: 'mp4'
                }
            });
        } else {
            console.warn("⚠️ Stream video R2 tidak tertangkap, menggunakan fallback.");
            return res.json({ success: true, data: { streamUrl: FALLBACK_VIDEO, type: 'mp4' } });
        }

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

        if (req.headers.range) {
            headers['Range'] = req.headers.range;
        }

        const response = await fetch(videoUrl, { headers });

        if (!response.ok && response.status !== 206) {
            return res.status(response.status).send("Gagal mengambil stream video dari CDN");
        }

        res.status(response.status);
        res.setHeader('Content-Type', response.headers.get('content-type') || 'video/mp4');
        res.setHeader('Access-Control-Allow-Origin', '*');
        
        if (response.headers.get('content-length')) {
            res.setHeader('Content-Length', response.headers.get('content-length'));
        }
        if (response.headers.get('content-range')) {
            res.setHeader('Content-Range', response.headers.get('content-range'));
        }
        if (response.headers.get('accept-ranges')) {
            res.setHeader('Accept-Ranges', response.headers.get('accept-ranges'));
        }

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
        if (!res.headersSent) {
            res.status(500).send("Proxy Stream Error");
        }
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