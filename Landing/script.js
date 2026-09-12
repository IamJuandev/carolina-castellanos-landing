const countdown = document.querySelector("[data-countdown]");
const countdownTarget = countdown
	? new Date(countdown.dataset.countdown).getTime()
	: NaN;
const countdownFields = {
	days: countdown?.querySelector("[data-countdown-days]"),
	hours: countdown?.querySelector("[data-countdown-hours]"),
	minutes: countdown?.querySelector("[data-countdown-minutes]"),
	seconds: countdown?.querySelector("[data-countdown-seconds]"),
};

function pad(value) {
	return String(value).padStart(2, "0");
}
function updateCountdown() {
	if (!countdown || Number.isNaN(countdownTarget)) return;
	const remaining = countdownTarget - Date.now();
	if (remaining <= 0) {
		countdown.classList.add("is-live");
		countdown.querySelector(".countdown-label").textContent = "Ya comenzó";
		window.clearInterval(countdownTimer);
		return;
	}
	const totalSeconds = Math.floor(remaining / 1000);
	countdownFields.days.textContent = Math.floor(totalSeconds / 86400);
	countdownFields.hours.textContent = pad(Math.floor((totalSeconds % 86400) / 3600));
	countdownFields.minutes.textContent = pad(Math.floor((totalSeconds % 3600) / 60));
	countdownFields.seconds.textContent = pad(totalSeconds % 60);
}
const countdownTimer = window.setInterval(updateCountdown, 1000);
updateCountdown();

const track = document.querySelector("[data-carousel-track]");
const slides = Array.from(document.querySelectorAll(".testimonial-slide"));
const dots = Array.from(document.querySelectorAll("[data-carousel-dot]"));
const prevButton = document.querySelector("[data-carousel-prev]");
const nextButton = document.querySelector("[data-carousel-next]");
const carousel = document.querySelector(".carousel");

let currentIndex = 0;
let timerId = null;
const intervalMs = 4200;
const prefersReducedMotion = window.matchMedia(
	"(prefers-reduced-motion: reduce)",
).matches;

function updateCarousel(index) {
	if (!track || !slides.length) return;
	currentIndex = (index + slides.length) % slides.length;
	track.style.transform = `translateX(-${currentIndex * 100}%)`;

	dots.forEach((dot, dotIndex) => {
		const isActive = dotIndex === currentIndex;
		dot.classList.toggle("active", isActive);
		dot.setAttribute("aria-selected", String(isActive));
	});
}

function nextSlide() {
	updateCarousel(currentIndex + 1);
}
function previousSlide() {
	updateCarousel(currentIndex - 1);
}
function startAutoplay() {
	if (prefersReducedMotion || timerId || document.hidden || !slides.length)
		return;
	timerId = window.setInterval(nextSlide, intervalMs);
}
function stopAutoplay() {
	window.clearInterval(timerId);
	timerId = null;
}
function restartAutoplay() {
	stopAutoplay();
	startAutoplay();
}

prevButton?.addEventListener("click", () => {
	previousSlide();
	restartAutoplay();
});
nextButton?.addEventListener("click", () => {
	nextSlide();
	restartAutoplay();
});
dots.forEach((dot, index) => {
	dot.addEventListener("click", () => {
		updateCarousel(index);
		restartAutoplay();
	});
	dot.addEventListener("keydown", (event) => {
		if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
		event.preventDefault();
		const nextIndex =
			event.key === "Home"
				? 0
				: event.key === "End"
					? dots.length - 1
					: index + (event.key === "ArrowRight" ? 1 : -1);
		const targetIndex = (nextIndex + dots.length) % dots.length;
		dots[targetIndex].focus();
		updateCarousel(targetIndex);
		restartAutoplay();
	});
});
carousel?.addEventListener("mouseenter", stopAutoplay);
carousel?.addEventListener("mouseleave", startAutoplay);
carousel?.addEventListener("focusin", stopAutoplay);
carousel?.addEventListener("focusout", (event) => {
	if (!carousel.contains(event.relatedTarget)) startAutoplay();
});
document.addEventListener("visibilitychange", () => {
	if (document.hidden) stopAutoplay();
	else startAutoplay();
});

updateCarousel(0);
startAutoplay();
