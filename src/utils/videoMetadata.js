export const getVideoMetadata = (file) => {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      window.URL.revokeObjectURL(video.src);
      resolve({
        width: video.videoWidth,
        height: video.videoHeight,
        duration: video.duration,
      });
    };
    video.onerror = () => {
      reject('Failed to load video metadata');
    };
    video.src = URL.createObjectURL(file);
  });
};

export const captureFirstFrame = (file) => {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.playsInline = true;
    video.muted = true;
    video.src = URL.createObjectURL(file);
    
    video.onloadedmetadata = () => {
      video.currentTime = 0.1; // Seek a bit in case the first frame is black
    };

    video.onseeked = () => {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg');
      window.URL.revokeObjectURL(video.src);
      resolve(dataUrl);
    };

    video.onerror = () => {
      reject('Failed to capture frame');
    };
  });
};
