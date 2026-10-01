import type { ImgHTMLAttributes } from 'react';

const preservedImages = [
  ['photo-1459749411175-04bf5292ceea', '/images/concert.jpg'],
  ['photo-1533174072545-7a4b6ad7a6c3', '/images/festival.jpg'],
  ['pexels-photo-1105666', '/images/live-stage.jpg'],
];

/** Keep the original demo photographs available without third-party requests. */
export function EventImage({
  src,
  alt,
  ...props
}: ImgHTMLAttributes<HTMLImageElement>) {
  const localImage = preservedImages.find(([identifier]) =>
    src?.includes(identifier),
  );
  return (
    <img
      {...props}
      src={
        src?.startsWith('https://ticketchain.local/images/')
          ? new URL(src).pathname
          : localImage?.[1] || src
      }
      alt={alt}
      onError={(event) => {
        const image = event.currentTarget;
        if (!image.src.endsWith('/images/concert.jpg'))
          image.src = '/images/concert.jpg';
      }}
    />
  );
}
