// Runs in the page's own JS world so it can see the responses Instagram's app
// already receives. It never makes requests of its own and never touches login data.
// Wrapped in its own scope: this file can be injected into a page more than
// once (on install/update the extension re-attaches to open Instagram tabs),
// and top-level declarations would collide with the earlier copy.
(() => {
  const IGMP = (() => {
    const TAG = '__igMusicProbe';
    const KEYWORDS = ['display_artist', 'original_sound_info', 'music_asset_info'];

    const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
    const idStr = (v) => (v === undefined || v === null || v === '' ? null : String(v));

    function looksRelevant(text) {
      if (!text || text.length > 25_000_000) return false;
      return KEYWORDS.some((k) => text.includes(k));
    }

    // Instagram responses are usually JSON, sometimes prefixed with for (;;);
    // and sometimes streamed as several JSON objects on separate lines.
    function parseLoose(text) {
      let t = text.trim();
      if (t.startsWith('for (;;);')) t = t.slice(9);
      try {
        return [JSON.parse(t)];
      } catch (_) {}
      const out = [];
      for (const line of t.split('\n')) {
        const s = line.trim();
        if (!s.startsWith('{') && !s.startsWith('[')) continue;
        try {
          out.push(JSON.parse(s));
        } catch (_) {}
      }
      return out;
    }

    // Walks any JSON shape. Doesn't depend on exact field paths, because
    // Instagram's web schema changes often. Two signals:
    //   - any object with title + display_artist  -> licensed song
    //   - any non-null original_sound_info        -> creator's original audio
    // The nearest ancestor with a shortcode (`code`) is recorded as the post.
    function extract(root) {
      const hits = [];
      const seen = new Set();
      const stack = [{ node: root, media: null, depth: 0 }];

      while (stack.length) {
        const { node, media: parentMedia, depth } = stack.pop();
        if (!node || typeof node !== 'object' || depth > 80) continue;

        if (Array.isArray(node)) {
          for (const c of node) stack.push({ node: c, media: parentMedia, depth: depth + 1 });
          continue;
        }

        let media = parentMedia;
        if (str(node.code) && (node.media_type !== undefined || node.product_type !== undefined)) {
          media = {
            code: node.code,
            product_type: str(node.product_type),
            owner: str(node.user && node.user.username) || str(node.owner && node.owner.username),
          };
        }

        const add = (h) => {
          const key = [h.kind, h.audio_id || '', (h.title || '').toLowerCase(),
            (h.artist || '').toLowerCase(), media ? media.code : ''].join('|');
          if (seen.has(key)) return;
          seen.add(key);
          hits.push({ ...h, post: media });
        };

        if (str(node.title) && str(node.display_artist)) {
          add({
            kind: 'song',
            title: str(node.title),
            artist: str(node.display_artist),
            audio_id: idStr(node.audio_cluster_id ?? node.audio_asset_id ?? node.id),
            explicit: !!node.is_explicit,
            duration_ms: typeof node.duration_in_ms === 'number' ? node.duration_in_ms : null,
          });
        }

        const osi = node.original_sound_info;
        if (osi && typeof osi === 'object' && !Array.isArray(osi)) {
          add({
            kind: 'original',
            title: str(osi.original_audio_title) || 'Original audio',
            artist: str(osi.ig_artist && osi.ig_artist.username),
            audio_id: idStr(osi.audio_asset_id ?? osi.audio_id),
            explicit: false,
            duration_ms: typeof osi.duration_in_ms === 'number' ? osi.duration_in_ms : null,
          });
        }

        for (const k in node) {
          const v = node[k];
          if (v && typeof v === 'object') stack.push({ node: v, media, depth: depth + 1 });
        }
      }
      return hits;
    }

    function extractFromText(text) {
      let hits = [];
      for (const obj of parseLoose(text)) hits = hits.concat(extract(obj));
      return hits;
    }

    return { TAG, looksRelevant, parseLoose, extract, extractFromText };
  })();

  if (typeof module !== 'undefined' && module.exports) module.exports = IGMP;

  if (typeof window !== 'undefined' && typeof window.fetch === 'function' && !window.__igmpInstalled) {
    window.__igmpInstalled = true;

    const shouldInspect = (url) => {
      try {
        const u = new URL(url, location.href);
        return u.hostname.endsWith('instagram.com') &&
          (u.pathname.includes('/graphql') || u.pathname.includes('/api/'));
      } catch (_) {
        return false;
      }
    };

    // GraphQL calls name themselves in the request body; useful for seeing
    // which query actually feeds the Explore grid.
    const friendlyName = (body) => {
      try {
        if (!body) return null;
        if (body instanceof URLSearchParams || body instanceof FormData) {
          return body.get('fb_api_req_friendly_name');
        }
        if (typeof body === 'string') {
          const m = body.match(/fb_api_req_friendly_name=([^&]+)/);
          return m ? decodeURIComponent(m[1]) : null;
        }
      } catch (_) {}
      return null;
    };

    const send = (payload) => {
      window.postMessage(
        { [IGMP.TAG]: true, page: location.pathname, at: Date.now(), ...payload },
        location.origin
      );
    };

    // Raw samples are only for the debug export, and the bridge keeps just a few.
    // Copying up to 300 KB through postMessage on every response is wasted work.
    const MAX_SAMPLES = 5;
    let samplesSent = 0;

    const handle = (url, text, name) => {
      setTimeout(() => {
        try {
          const relevant = IGMP.looksRelevant(text);
          const hits = relevant ? IGMP.extractFromText(text) : [];
          const withSample = hits.length > 0 && samplesSent < MAX_SAMPLES;
          if (withSample) samplesSent++;
          send({
            url,
            name: name || null,
            relevant,
            hits,
            sample: withSample ? text.slice(0, 300_000) : null,
          });
        } catch (err) {
          console.warn('[Explore Finds]', err);
        }
      }, 0);
    };

    const origFetch = window.fetch;
    window.fetch = function (input, init) {
      const p = origFetch.apply(this, arguments);
      try {
        const reqUrl = typeof input === 'string' ? input : (input && input.url) || String(input);
        if (shouldInspect(reqUrl)) {
          const name = friendlyName(init && init.body);
          p.then((res) => res.clone().text())
            .then((t) => handle(reqUrl, t, name))
            .catch(() => {});
        }
      } catch (_) {}
      return p;
    };

    const XO = XMLHttpRequest.prototype.open;
    const XS = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url) {
      this.__igmpUrl = url;
      return XO.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function (body) {
      try {
        const url = this.__igmpUrl && String(this.__igmpUrl);
        if (url && shouldInspect(url)) {
          const name = friendlyName(body);
          this.addEventListener('load', () => {
            try {
              let text = null;
              if (this.responseType === '' || this.responseType === 'text') text = this.responseText;
              else if (this.responseType === 'json' && this.response) text = JSON.stringify(this.response);
              if (text) handle(url, text, name);
            } catch (_) {}
          });
        }
      } catch (_) {}
      return XS.apply(this, arguments);
    };

    // The first screen of posts often arrives inside the page HTML, not via a request.
    const scanEmbedded = () => {
      document.querySelectorAll('script[type="application/json"]').forEach((s) => {
        if (s.__igmpDone) return;
        s.__igmpDone = true;
        const t = s.textContent;
        if (IGMP.looksRelevant(t)) handle(location.href + '#embedded', t, 'embedded-html');
      });
    };
    document.addEventListener('DOMContentLoaded', scanEmbedded);
    window.addEventListener('load', scanEmbedded);
  }
})();
