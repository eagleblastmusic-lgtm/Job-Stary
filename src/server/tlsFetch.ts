import http from 'node:http';
import https from 'node:https';

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface TlsFetchOptions extends RequestInit {
  maxRedirects?: number;
}

export async function tlsFetch(input: string | URL | Request, init?: TlsFetchOptions): Promise<Response> {
  let url = typeof input === 'string' ? new URL(input) : input instanceof URL ? input : new URL(input.url);
  const maxRedirects = init?.maxRedirects ?? 5;
  let redirects = 0;

  while (true) {
    const isHttps = url.protocol === 'https:';
    const requestModule = isHttps ? https : http;

    const headers: Record<string, string> = {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json,*/*;q=0.8',
      'accept-language': 'pl-PL,pl;q=0.9,en-US;q=0.8,en;q=0.7',
      'host': url.hostname
    };

    if (init?.headers) {
      if (init.headers instanceof Headers) {
        init.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
      } else if (Array.isArray(init.headers)) {
        for (const pair of init.headers) {
          const k = pair[0];
          const v = pair[1];
          if (k && v !== undefined) headers[k.toLowerCase()] = v;
        }
      } else {
        for (const [k, v] of Object.entries(init.headers)) {
          if (v !== undefined) headers[k.toLowerCase()] = String(v);
        }
      }
    }

    const response = await new Promise<Response>((resolve, reject) => {
      const options: https.RequestOptions = {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: init?.method ?? 'GET',
        headers,
        signal: init?.signal ?? undefined,
        ...(isHttps ? { minVersion: 'TLSv1.3', maxVersion: 'TLSv1.3' } : {})
      };

      const req = requestModule.request(options, res => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const bodyBuffer = Buffer.concat(chunks);
          const resHeaders = new Headers();
          for (const [k, v] of Object.entries(res.headers)) {
            if (Array.isArray(v)) {
              for (const item of v) resHeaders.append(k, item);
            } else if (v !== undefined) {
              resHeaders.set(k, v);
            }
          }
          const resp = new Response(bodyBuffer, {
            status: res.statusCode ?? 200,
            statusText: res.statusMessage ?? '',
            headers: resHeaders
          });
          resolve(resp);
        });
      });

      req.on('error', reject);

      if (init?.body) {
        if (typeof init.body === 'string' || Buffer.isBuffer(init.body)) {
          req.write(init.body);
        }
      }

      req.end();
    });

    if ([301, 302, 303, 307, 308].includes(response.status) && response.headers.has('location')) {
      const location = response.headers.get('location');
      if (location) {
        redirects++;
        if (redirects > maxRedirects) {
          throw new Error(`Zbyt wiele przekierowań (limit ${maxRedirects}).`);
        }
        url = new URL(location, url);
        continue;
      }
    }

    return response;
  }
}
