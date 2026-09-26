// MA image proxy helpers.

/** Sizes accepted by `/imageproxy` (0 = original). */
export const IMAGE_PROXY_SIZES = [0, 80, 160, 256, 512, 1024] as const;

/** Smallest accepted proxy size >= `size` (Stream Deck keys at 144 px → 160). */
export function snapImageSize(size: number): number {
    if (size <= 0) return 0;
    return IMAGE_PROXY_SIZES.find((s) => s >= size) ?? 0;
}
