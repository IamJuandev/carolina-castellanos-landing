const countdown = document.querySelector("[data-countdown]");
const countdownTarget = countdown
	? new Date(countdown.dataset.countdown).getTime()
	: Number.NaN;
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
