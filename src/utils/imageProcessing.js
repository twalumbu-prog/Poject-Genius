/**
 * Utility for image processing and high-contrast enhancement filters.
 */

/**
 * Applies a CamScanner-style high-contrast filter to an image.
 * This makes handwriting pop by whitening the background and darkening the ink.
 * @param {string} base64Image - The source image in base64 format.
 * @returns {Promise<string>} - The processed image in base64 format.
 */
export async function applyDocScanFilter(base64Image) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            canvas.width = img.width;
            canvas.height = img.height;

            // Draw original image
            ctx.drawImage(img, 0, 0);

            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const data = imageData.data;

            // Simple Grayscale + High Contrast Thresholding
            // We use a simplified local adaptive threshold proxy
            for (let i = 0; i < data.length; i += 4) {
                const r = data[i];
                const g = data[i + 1];
                const b = data[i + 2];

                // Calculate luminance
                let gray = 0.299 * r + 0.587 * g + 0.114 * b;

                // CamScanner-style enhancement:
                // 1. Shift whites: make almost-white pixels pure white
                // 2. Shift darks: make almost-dark pixels pure black
                // 3. Sharpening effect through steep contrast curve

                if (gray > 160) {
                    gray = 255; // Whitening the background
                } else if (gray < 80) {
                    gray = 0;   // Darkening the ink
                } else {
                    // Normalize the midtones to be high contrast
                    gray = ((gray - 80) / (160 - 80)) * 255;
                    gray = gray > 128 ? 255 : 0; // Binarization
                }

                data[i] = data[i + 1] = data[i + 2] = gray;
            }

            ctx.putImageData(imageData, 0, 0);
            resolve(canvas.toDataURL('image/jpeg', 0.8));
        };
        img.onerror = reject;
        img.src = base64Image;
    });
}
