const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const videos = [...document.querySelectorAll('.video-card video')];
const videoTrack = document.getElementById('benchmarkVideos');
const carouselToggle = document.getElementById('videoCarouselToggle');
const CAROUSEL_SPEED = 32; // Continuous movement in CSS pixels per second.
let carouselFrame = null, carouselLastTime = null, carouselRemainder = 0;
let carouselWheelTimer, carouselWheeling = false;
let carouselVisible = false, carouselPaused = false;
let carouselHovered = false, carouselFocused = false, carouselDragging = false;

function carouselStep() {
  const cards = videoTrack.children;
  return cards.length > 1 ? cards[1].getBoundingClientRect().left - cards[0].getBoundingClientRect().left : 0;
}

// Move only cards that have already left the viewport. Resetting the scroll
// offset in the same task keeps the visible cards in place, including at wrap.
function normalizeCarousel() {
  const step = carouselStep();
  if (step <= 0) return;
  let left = videoTrack.scrollLeft;
  while (left >= step - 1) {
    pauseVideo(videoTrack.firstElementChild.querySelector('video'));
    videoTrack.append(videoTrack.firstElementChild);
    left = Math.max(0, left - step);
    videoTrack.scrollLeft = left;
  }
}

function carouselCanPlay() {
  return carouselVisible && !document.hidden && !document.fullscreenElement &&
    !reducedMotion.matches && !carouselPaused && !carouselHovered &&
    !carouselFocused && !carouselDragging && !carouselWheeling;
}

function tickCarousel(now) {
  carouselFrame = null;
  if (!carouselCanPlay()) { carouselLastTime = null; return; }
  if (carouselLastTime !== null) {
    const elapsed = Math.min((now - carouselLastTime) / 1000, 0.1);
    // Retain subpixel movement so speed is consistent on integer-scroll browsers.
    carouselRemainder += CAROUSEL_SPEED * elapsed;
    const before = videoTrack.scrollLeft;
    videoTrack.scrollLeft = before + carouselRemainder;
    carouselRemainder -= videoTrack.scrollLeft - before;
    normalizeCarousel();
  }
  carouselLastTime = now;
  carouselFrame = requestAnimationFrame(tickCarousel);
}

function syncCarousel() {
  if (!carouselCanPlay()) {
    cancelAnimationFrame(carouselFrame);
    carouselFrame = null;
    carouselLastTime = null;
    carouselRemainder = 0;
  } else if (carouselFrame === null) {
    carouselFrame = requestAnimationFrame(tickCarousel);
  }
}

videoTrack.addEventListener('pointerenter', event => {
  if (event.pointerType !== 'mouse') return;
  carouselHovered = true;
  syncCarousel();
});
videoTrack.addEventListener('pointerleave', () => {
  carouselHovered = false;
  syncCarousel();
});
videoTrack.addEventListener('focusin', () => { carouselFocused = true; syncCarousel(); });
videoTrack.addEventListener('focusout', () => {
  requestAnimationFrame(() => {
    carouselFocused = videoTrack.contains(document.activeElement);
    syncCarousel();
  });
});
videoTrack.addEventListener('pointerdown', () => { carouselDragging = true; syncCarousel(); });
window.addEventListener('pointerup', () => { carouselDragging = false; syncCarousel(); });
window.addEventListener('pointercancel', () => { carouselDragging = false; syncCarousel(); });
videoTrack.addEventListener('wheel', () => {
  carouselWheeling = true;
  clearTimeout(carouselWheelTimer);
  syncCarousel();
  carouselWheelTimer = setTimeout(() => { carouselWheeling = false; syncCarousel(); }, 1500);
}, { passive: true });
new ResizeObserver(syncCarousel).observe(videoTrack);
new IntersectionObserver(entries => {
  carouselVisible = entries[0].isIntersecting;
  syncCarousel();
}, { threshold: 0.1 }).observe(videoTrack);
document.addEventListener('fullscreenchange', syncCarousel);
carouselToggle.addEventListener('click', () => {
  carouselPaused = !carouselPaused;
  carouselToggle.textContent = carouselPaused ? 'Resume' : 'Pause';
  carouselToggle.setAttribute('aria-label', carouselPaused ? 'Resume automatic video scrolling' : 'Pause automatic video scrolling');
  syncCarousel();
});
videoTrack.classList.add('auto-carousel');
carouselToggle.parentElement.hidden = false;

const mediaState = new WeakMap(videos.map(video => [video, {
  visible: false, loaded: false, userPaused: false, automaticPause: false,
}]));

function loadVideo(video) {
  const state = mediaState.get(video);
  if (state.loaded) return;
  state.loaded = true;
  const source = video.querySelector('source');
  source.src = source.dataset.src;
  source.addEventListener('error', () => {
    video.closest('figure').querySelector('.video-error').hidden = false;
  });
  video.load();
}

function pauseVideo(video) {
  if (video.paused) return;
  mediaState.get(video).automaticPause = true;
  video.pause();
}

function syncVideo(video) {
  const state = mediaState.get(video);
  if (!state.visible || document.hidden) {
    pauseVideo(video);
  } else if (!reducedMotion.matches && !state.userPaused) {
    loadVideo(video);
    // Browser autoplay restrictions still leave the native play control available.
    video.play().catch(() => {});
  }
}

for (const video of videos) {
  video.addEventListener('pause', () => {
    const state = mediaState.get(video);
    if (!state.automaticPause) state.userPaused = true;
    state.automaticPause = false;
  });
  video.addEventListener('play', () => { mediaState.get(video).userPaused = false; });
  video.addEventListener('error', () => {
    video.closest('figure').querySelector('.video-error').hidden = false;
  });
}

const preload = new IntersectionObserver(entries => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    loadVideo(entry.target);
    preload.unobserve(entry.target);
  }
}, { rootMargin: '200px' });
const playback = new IntersectionObserver(entries => {
  for (const entry of entries) {
    mediaState.get(entry.target).visible = entry.isIntersecting;
    syncVideo(entry.target);
  }
}, { threshold: 0.05 });
videos.forEach(video => { preload.observe(video); playback.observe(video); });
document.addEventListener('visibilitychange', () => { videos.forEach(syncVideo); syncCarousel(); });
reducedMotion.addEventListener('change', () => {
  syncCarousel();
  for (const video of videos) {
    if (reducedMotion.matches) pauseVideo(video);
    else syncVideo(video);
  }
});

// The heavy geometry module and its point clouds load only near their section.
const sections = new IntersectionObserver(entries => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    sections.unobserve(entry.target);
    const geometry = entry.target.id === 'demo';
    const status = document.getElementById(geometry ? 'geometryStatus' : 'cameraStatus');
    status.textContent = geometry ? 'Loading interactive results…' : 'Loading camera comparisons…';
    import(geometry ? './geometry.js' : './camera.js')
      .then(module => module.ready)
      .catch(() => {
        status.textContent = 'Interactive results could not load. The static comparison remains available.';
      });
  }
}, { rootMargin: '200px' });
sections.observe(document.getElementById('demo'));
sections.observe(document.getElementById('camctrl'));

const copyButton = document.getElementById('copyCitation');
copyButton.addEventListener('click', async () => {
  const code = document.getElementById('bibtex');
  const status = document.getElementById('copyStatus');
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(code.textContent);
    } else {
      const range = document.createRange();
      range.selectNodeContents(code);
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      if (!document.execCommand('copy')) throw new Error('Clipboard unavailable');
      selection.removeAllRanges();
    }
    status.textContent = 'BibTeX copied.';
  } catch {
    const range = document.createRange();
    range.selectNodeContents(code);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    status.textContent = 'Select and copy the highlighted BibTeX.';
  }
});
