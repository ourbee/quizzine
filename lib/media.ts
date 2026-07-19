export type MediaKind = "youtube" | "image" | "audio" | "link";

export function classifyMedia(url: string): { kind: MediaKind; embed?: string } {
  const yt = url.match(
    /(?:youtube\.com\/(?:watch\?[^#]*v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/
  );
  if (yt) return { kind: "youtube", embed: `https://www.youtube.com/embed/${yt[1]}` };
  if (/\.(png|jpe?g|gif|webp|svg|avif)(\?|#|$)/i.test(url)) return { kind: "image" };
  if (/\.(mp3|ogg|wav|m4a|aac)(\?|#|$)/i.test(url)) return { kind: "audio" };
  return { kind: "link" };
}
