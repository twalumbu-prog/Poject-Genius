export async function applyDocScanFilter(base64Image) {
    // Skip image filter for PDFs or any non-image data
    if (!base64Image.startsWith('data:image/')) {
        return base64Image;
    }

    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');

            // Cap resolution at 1600px on the longest side.
            // Phone camera images can be 3000-4000px wide; sending them raw
            // at full size causes 546 "compute resource exceeded" errors in
            // the Supabase edge function. 1600px is more than enough for OCR.
            const MAX_DIM = 1600;
            let { width, height } = img;
            if (width > MAX_DIM || height > MAX_DIM) {
                const scale = MAX_DIM / Math.max(width, height);
                width = Math.round(width * scale);
                height = Math.round(height * scale);
            }

            canvas.width = width;
            canvas.height = height;

            // Draw scaled image
            ctx.drawImage(img, 0, 0, width, height);

            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const data = imageData.data;

            // Simple Grayscale + High Contrast Thresholding
            for (let i = 0; i < data.length; i += 4) {
                const r = data[i];
                const g = data[i + 1];
                const b = data[i + 2];

                let gray = 0.299 * r + 0.587 * g + 0.114 * b;

                if (gray > 160) {
                    gray = 255;
                } else if (gray < 80) {
                    gray = 0;
                } else {
                    gray = ((gray - 80) / (160 - 80)) * 255;
                    gray = gray > 128 ? 255 : 0;
                }

                data[i] = data[i + 1] = data[i + 2] = gray;
            }

            ctx.putImageData(imageData, 0, 0);
            // 0.82 quality — good clarity for handwriting, keeps size small
            resolve(canvas.toDataURL('image/jpeg', 0.82));
        };
        img.onerror = reject;
        img.src = base64Image;
    });
}
