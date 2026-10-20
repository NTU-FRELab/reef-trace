# ReefTrace

Browser-based Pocillopora colony annotation, appearance-based segmentation suggestions, and longitudinal colony records, developed for the Functional Reef Ecology Lab (FRELab).

## Run locally

No build step or dependencies. Serve this directory with `python -m http.server 8000`, then open http://localhost:8000 in a modern browser.

## Workflow

1. Import original reef photos and enter site/quadrat and survey date.
2. Outline individual Pocillopora colonies and representative background regions.
3. Assign persistent colony IDs across surveys after visual confirmation.
4. Set image scale using a known distance in centimetres.
5. Train the appearance model on manual polygons in images assigned to the training split.
6. Generate suggestions on unreviewed images; correct boundaries before accepting them. Apply details marks a selected outline as manual.
7. Export COCO annotations, growth CSV, or a complete project JSON backup.

## Model

A two-class Gaussian naive Bayes classifier uses relative red, relative green, relative blue, and mean RGB brightness. Channels are normalized to 0–1; relative colors use R+G+B+0.02 as the denominator. Equal class priors and independent feature variances are used. Training samples every second pixel in images downscaled to a maximum dimension of 400. Inference downsamples to a maximum dimension of 700, groups connected pixels, removes small components, and approximates boundaries with convex hulls.

This is an unvalidated appearance baseline, not a species-aware deep instance-segmentation model. It does not use texture, morphology, or temporal identity features. Touching colonies can merge; colonies can split; convex hulls can overestimate irregular boundaries. All predictions need review. Train/validation/test assignments are stored but no held-out accuracy evaluation is currently implemented.

## Data storage and exports

Photos, annotations, metadata, calibration, and the trained model autosave in IndexedDB in the current browser. There is no server dataset storage or cross-device synchronization. Browser data clearing can erase the workspace. Save project downloads include original photos as data URLs and can be restored with Open project. COCO JSON exports contain annotations and metadata only; retain the original image files alongside them. No research images or user annotations are included in this repository.

## Growth interpretation

Areas are 2D projected areas, not 3D colony surface area. Scale calibration does not correct perspective, camera angle, occlusion, or distortion. Use comparable orthogonal imagery or orthomosaics. Colony IDs are assigned manually; missing observations do not imply death. Record fragmentation and fusion in notes. Percentage changes require dates and calibrated areas.

## Validation

JavaScript syntax and core geometry/classifier checks passed during initial development. Browser interaction and segmentation accuracy have not been validated on a real annotated reef dataset.
