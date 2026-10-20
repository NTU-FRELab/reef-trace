# ReefTrace

Local Pocillopora colony annotation, texture-based segmentation suggestions, and longitudinal records for the Functional Reef Ecology Lab (FRELab). The original main layout and stylesheet are preserved. Updated model controls are inside the existing Train / manage model dialog.

## Run

No build step, third-party runtime libraries, or machine-learning server is required. Serve the app directory using `python -m http.server 8000`, then visit http://localhost:8000 in a modern browser. On GitHub the app files are at the repository root; the Sites source keeps them in `dist/`. Use HTTP localhost or HTTPS, not a file URL (Web Workers require a suitable origin).

## Annotate, train, and apply

1. Import photos; set site/quadrat, date, and train/validation/test role.
2. Draw colony polygons and representative background polygons, including confusing rubble, algae, shadows and other coral species. Unlabeled training pixels are ignored, not assumed negative.
3. Open **Train / manage model** and select working resolution, forest size, and optional mask cleanup. Train using manual or explicitly accepted polygons from train images only.
4. **Suggest on unreviewed images** runs a batch. Manual coral and background regions are excluded from prediction; their annotations are preserved. A successful batch replaces only previous model suggestions. Failed or cancelled batches leave existing annotations unchanged.
5. Correct each suggestion using Select / edit vertices, including interior-hole vertices. **Apply details** explicitly accepts the selected outline as manual, making it eligible for later training. Draw/delete polygons to separate touching colonies when needed. Assign persistent IDs manually across dates.
6. Save the model for reuse, save complete project backups, and export COCO or growth CSV as required.

## Version 2 model

The original four-feature Gaussian color classifier is replaced by a dependency-free, bootstrapped randomized decision-tree forest trained entirely in a browser worker. Each node searches randomly selected features and candidate thresholds for Gini impurity reduction. The forest learns nonlinear combinations of 29 pixel features:

| Family | Features |
|---|---|
| Color and illumination | Relative R/G/B, luminance, saturation |
| Multiscale contrast | Local mean and standard deviation at radii 2, 5, 11; locally normalized luminance; fine/coarse mean difference |
| Edges | Sobel magnitude; local edge mean and variability; absolute Laplacian |
| Texture | Rotation-invariant uniform LBP code and bright-neighbor count at radii 1 and 3; local LBP mean and variability |
| Local structure | Structure-tensor coherence and energy; eigenvalues of finite-difference Hessians on box-smoothed luminance at radii 2 and 5 |

The local structure features describe ridge/blob responses and orientation coherence. **Whole-colony morphology is not learned**, and there is no pretrained Pocillopora recognition or deep instance model. Background annotation patches are arbitrary shapes, so imposing a colony-shape classifier on those patches would be misleading.

Training and inference use the **same saved working resolution**, unlike the first version. Maximum image dimension is 768, 1024, or 1536 working pixels; original photos and annotation coordinates retain full resolution. Feature radii are working-image pixels, not centimetres. Keep camera distance, framing and resolution reasonably comparable. Detail below the working resolution cannot be recovered. Larger settings use more memory and computation.

Per-image, per-class reservoir sampling limits dominance by a single large colony. Each image contributes at most 2,000 samples per class. Global reservoirs cap each class at 6,000 samples, and equal class counts train the forest. Default forest size is 32 trees (48/64 optional), maximum depth 12, minimum leaf size 6. Split importance is displayed for inspection; it is not a biological explanation or independent performance measure. The coral vote threshold is an uncalibrated forest score, not a calibrated probability.

The approach follows the local-feature trainable segmentation family documented by [scikit-image](https://scikit-image.org/docs/stable/auto_examples/segmentation/plot_trainable_segmentation.html) and [ImageJ Trainable Weka Segmentation](https://imagej.net/plugins/tws/). This JavaScript implementation is not their software and does not claim equivalent performance.

## Masks and boundaries

Optional disk-shaped morphological opening followed by closing removes speckles and small cracks. Cleanup defaults to **None**, since it can erase thin branches, change area, and merge or split regions. Its radius is saved with the model; changing it invalidates the stored evaluation.

Four-connected foreground components become exact pixel-edge contours. Concavities and interior holes are preserved, replacing the old convex hull approximation. There is no automatic separation of touching biological colonies, no watershed instance guarantee, and no identity matching. Growth areas subtract holes. COCO exports use polygon segmentation for instances without holes and uncompressed column-major COCO RLE for instances with holes; use tooling that supports RLE (some polygon-only importers do not).

## Local models and data

- All photos, annotations, metadata and the trained forest autosave in this browser's IndexedDB. No image or training feature is uploaded by the model engine. There is no cross-computer synchronization.
- **Save model** downloads a standalone `reeftrace-texture-model.reefmodel.json` containing trees, feature schema, preprocessing settings, feature importance and optional evaluation. It contains source image hashes/names/site/date metadata but no photos or pixel training samples. **Load model** applies it to new photos without the training project. Imported models are checked for compatible schema and valid tree structures.
- **Save project** includes original photos as data URLs, annotations, and the model. **Open project** restores it. Old project annotations remain supported, but old color-only models must be retrained before batch prediction.
- Clearing browser data can erase the workspace. Keep downloaded backups. No research photos, annotations or trained research models are committed in this repository.

## Held-out validation

To evaluate, assign separate photos to validation/test, manually delineate **all** coral colonies, accept or remove every suggested polygon, and mark each image fully annotated/reviewed. Unoutlined pixels in these complete held-out images count as background. The app reports pooled pixel IoU, Dice, precision and recall on the final cleaned mask at the model's working resolution, plus per-image counts in the model export. Full-photo SHA-256 fingerprints reject exact training-image reuse. A warning flags shared site labels; this does not detect all overlapping views or near-duplicate photos.

Keep all overlapping images and years from a quadrat in the same split when measuring transfer to new sites. Temporal transfer within a site is a different evaluation question. Partial annotations or missed colonies make the metrics invalid. Scores do **not** measure instance separation or tracking accuracy. Re-evaluate after editing ground truth, changing the threshold, or changing cleanup. Saved scores describe the dataset at evaluation time; the app does not automatically detect later label edits. The test split is not used for fitting; use validation for tuning and reserve test for a final assessment.

## Growth

Areas are 2D projected areas, not 3D surface area. Scale calibration does not correct camera angle, perspective, distortion or occlusion. Use comparable orthogonal imagery or orthomosaics. Missing observations do not imply death; note fragmentation and fusion. Persistent IDs are assigned manually.

## Engineering checks and limits

Run `node --test tests/model.test.cjs`. Tests cover finite feature maps, explicit training labels, overlaps/holes, randomized mask-to-contour round trips, cleanup, discrimination of synthetic equal-color textures, model serialization/validation, metric math, worker training/inference, and preservation of the original stylesheet/layout structure.

These checks do not establish biological accuracy. No user reef images have been supplied for real-data validation. Browser interaction testing has not been completed in this environment. Forests with these handcrafted features can still confuse similar textures, bleaching, shadows, other branching corals or changes in image scale. Reviewed COCO annotations remain available for subsequent training of a more capable instance-segmentation model.
