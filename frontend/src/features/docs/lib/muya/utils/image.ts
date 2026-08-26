import type { ImageToken } from '../inlineRenderer/types';
import { tokenizer } from '../inlineRenderer/lexer';
import { findContentDOM, getOffsetOfParagraph } from '../selection/dom';

export interface IImageInfo {
    token: ImageToken;
    imageId: string;
}

export function getImageInfo(image: HTMLElement): IImageInfo {
    const paragraph = findContentDOM(image)!;
    const raw = image.getAttribute('data-raw')!;
    const offset = getOffsetOfParagraph(image, paragraph);
    const tokens = tokenizer(raw);
    const token = tokens[0] as ImageToken;
    token.range = {
        start: offset,
        end: offset + raw.length,
    };

    return {
        token,
        imageId: image.id,
    };
}

export function getImageSrc(src: string) {
    const EXT_REG = /\.(?:jpeg|jpg|png|gif|svg|webp)(?=\?|$)/i;
    const URL_REG
        = /^https?:\/\/(?:[\w\-.~]+\.[a-z]{2,}|[0-9.]+|localhost|\[[a-f0-9.:]+\])(?::\d{1,5})?\/\S+/i;
    const DATA_URL_REG
        = /^data:image\/[\w+-]+(?:;[\w-]+=[\w-]+|;base64)*,[a-zA-Z0-9+/]+={0,2}$/;
    const imageExtension = EXT_REG.test(src);
    const isUrl = URL_REG.test(src) || DATA_URL_REG.test(src) || src.startsWith('blob:') || src.startsWith('/');

    if (isUrl) {
        return {
            isUnknownType: false,
            src,
        };
    }

    if (imageExtension) {
        return {
            isUnknownType: false,
            src,
        };
    }

    return {
        isUnknownType: false,
        src,
    };
}

export async function loadImage(url: string, detectContentType = false): Promise<{
    url: string;
    width: number;
    height: number;
}> {
    if (detectContentType) {
        const isImage = await checkImageContentType(url);
        // Only bail out when we positively know it is NOT an image. `null`
        // means we couldn't check (e.g. a cross-origin HEAD blocked by CSP);
        // fall through to the actual load, which `img-src` permits (#3837).
        if (isImage === false)
            // eslint-disable-next-line prefer-promise-reject-errors
            return Promise.reject('not an image.');
    }

    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => {
            resolve({
                url,
                width: image.width,
                height: image.height,
            });
        };

        image.onerror = (err) => {
            reject(err);
        };
        image.src = url;
    });
}

// Only a same-origin URL can have its Content-Type read from the renderer: a
// cross-origin response has its headers stripped by CORS, and the app's CSP
// (no `connect-src`, so it falls back to `default-src 'self'`) refuses the
// request outright. Relative/opaque URLs are treated as same-origin so the
// check is still attempted.
function isSameOrigin(url: string): boolean {
    try {
        return new URL(url, window.location.href).origin === window.location.origin;
    }
    catch {
        return true;
    }
}

// Returns `true`/`false` when a HEAD response positively identifies the URL as
// an image (or not), or `null` when that can't be determined. A `null` must NOT
// be read as "not an image": the actual <img> load is governed by the far more
// permissive `img-src`, so callers should still attempt it (#3837 — shields.io
// badges and other extensionless remote images).
export async function checkImageContentType(url: string): Promise<boolean | null> {
    // Don't fire a HEAD we could never read: a cross-origin request is refused
    // by the CSP (logging a console error) and unreadable under CORS anyway.
    // Report "undetermined" and let the caller fall through to the <img> load.
    if (!isSameOrigin(url))
        return null;

    try {
        const res = await fetch(url, { method: 'HEAD' });
        if (res.status !== 200)
            return null;

        // Content-Type can carry parameters (e.g. `image/svg+xml;charset=utf-8`);
        // match only the MIME type.
        const contentType = res.headers.get('content-type')?.split(';')[0].trim();
        if (!contentType)
            return null;

        return /^image\/(?:jpeg|png|gif|svg\+xml|webp)$/.test(contentType);
    }
    catch {
        return null;
    }
}

// Percent-encode the chars that break a markdown image destination — an
// unbalanced `)` truncates the path (#3060). `encodeURIComponent` leaves `(`/`)`
// untouched, so encode them explicitly.
export function encodeImageSrc(src: string): string {
    return src
        .replace(/ /g, encodeURI(' '))
        .replace(/#/g, encodeURIComponent('#'))
        .replace(/\(/g, '%28')
        .replace(/\)/g, '%29');
}

export function correctImageSrc(src: string) {
    return src;
}
