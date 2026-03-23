"use client";

interface VideoPlayerProps {
  gravacaoId: string;
}

export const VideoPlayer = ({ gravacaoId }: VideoPlayerProps) => {
  return (
    <div className="overflow-hidden rounded-lg bg-black">
      <video
        className="aspect-video w-full"
        controls
        preload="metadata"
        src={`/api/gravacoes/${gravacaoId}/stream`}
      />
    </div>
  );
};
