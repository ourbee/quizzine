"use client";

import { classifyMedia } from "@/lib/media";

export default function Media({ url, compact }: { url?: string; compact?: boolean }) {
  if (!url) return null;
  const { kind, embed } = classifyMedia(url);
  if (kind === "youtube") {
    return (
      <div className={`relative w-full ${compact ? "max-w-md" : "max-w-xl"} aspect-video my-3`}>
        <iframe
          src={embed}
          className="absolute inset-0 w-full h-full rounded-lg border border-black/10"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          title="Video"
        />
      </div>
    );
  }
  if (kind === "image") {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="Question media" className={`${compact ? "max-h-48" : "max-h-80"} max-w-full rounded-lg border border-black/10 my-3`} />;
  }
  if (kind === "audio") {
    return <audio controls src={url} className="my-3 w-full max-w-md" />;
  }
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="inline-block my-2 text-sm underline underline-offset-2 break-all">
      {url}
    </a>
  );
}
