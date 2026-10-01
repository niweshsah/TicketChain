The original concert photographs remain available alongside the expanded local seed imagery. Microphone model by [Helindu](https://sketchfab.com/Helindu), [source](https://sketchfab.com/3d-models/microphone-a02d9505b3434adf84bc01bea7af4548), licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The model is preserved as `apps/web/public/microphone.glb`.

The three original demo photographs are cached in `apps/web/public/images` from their seed URLs (two Unsplash concert/festival photographs and the Pexels stage photograph). The renderer uses these local copies for matching URLs and a concert fallback when an organizer's image cannot load. Original URLs remain stored on events.

## Additional locally served concert photographs

Eight additional photographs are credited to Unsplash contributors and stored under `apps/web/public/images/concerts/`. Original image sources (the file order is concert-1 through concert-8):

1. https://images.unsplash.com/photo-1492684223066-81342ee5ff30
2. https://images.unsplash.com/photo-1514525253161-7a46d19cd819
3. https://images.unsplash.com/photo-1501386761578-eac5c94b800a
4. https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3
5. https://images.unsplash.com/photo-1516280440614-37939bbacd81
6. https://images.unsplash.com/photo-1506157786151-b8491531f063
7. https://images.unsplash.com/photo-1521337581100-8ca9a73a5f79
8. https://images.unsplash.com/photo-1540039155733-5bb30b53aa14

Source: [Unsplash](https://unsplash.com/), [license](https://unsplash.com/license). The CDN supplied resized JPEGs; no runtime third-party requests are needed for seeded imagery. Stable seed identifiers select distinct photographs. The targeted demo imagery command only changes known seed photographs and leaves inventory and order snapshots intact. Existing microphone attribution remains above.
