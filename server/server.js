import express from "express";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { timingSafeEqual } from "node:crypto";
import { getSettings, saveSettings, FIELDS } from "./db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LANDING_DIR = join(__dirname, "..", "Landing");
const PORT = Number(process.env.PORT ?? 3000);
const ADMIN_USER = process.env.ADMIN_USER ?? "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const TIMEZONE = "America/Bogota";
const TZ_OFFSET = "-05:00";

if (!ADMIN_PASSWORD) {
	console.error("ADMIN_PASSWORD env var is required");
	process.exit(1);
}

const landingTemplate = readFileSync(join(LANDING_DIR, "index.html"), "utf8");
const adminTemplate = readFileSync(join(__dirname, "cronograma.html"), "utf8");

const dateFormatter = new Intl.DateTimeFormat("es-CO", {
	day: "numeric",
	month: "long",
	timeZone: TIMEZONE,
});
const timeFormatter = new Intl.DateTimeFormat("es-CO", {
	hour: "numeric",
	minute: "2-digit",
	hour12: true,
	timeZone: TIMEZONE,
});

function escapeHtml(value) {
	return String(value)
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

function render(template, values) {
	return template.replaceAll(/\{\{(\w+)\}\}/g, (_, key) =>
		escapeHtml(values[key] ?? ""),
	);
}

function deriveLabels(settings) {
	const iso = `${settings.start_date}T${settings.start_time}:00${TZ_OFFSET}`;
	const date = new Date(iso);
	const valid = !Number.isNaN(date.getTime());
	return {
		countdown_iso: valid ? iso : "",
		start_label: valid ? dateFormatter.format(date) : settings.start_date,
		time_label: valid
			? `${timeFormatter.format(date)} Bogotá`
			: settings.start_time,
	};
}

function safeEqual(a, b) {
	const left = Buffer.from(a);
	const right = Buffer.from(b);
	return left.length === right.length && timingSafeEqual(left, right);
}

function requireAuth(req, res, next) {
	const header = req.headers.authorization ?? "";
	const [scheme, encoded] = header.split(" ");
	if (scheme === "Basic" && encoded) {
		const [user, ...rest] = Buffer.from(encoded, "base64")
			.toString("utf8")
			.split(":");
		const password = rest.join(":");
		if (safeEqual(user, ADMIN_USER) && safeEqual(password, ADMIN_PASSWORD)) {
			return next();
		}
	}
	res.set("WWW-Authenticate", 'Basic realm="Cronograma", charset="UTF-8"');
	res.status(401).send("Acceso restringido");
}

function validate(body) {
	const errors = [];
	if (!/^\d{4}-\d{2}-\d{2}$/.test(body.start_date ?? "")) {
		errors.push("La fecha de inicio no es válida.");
	}
	if (!/^\d{2}:\d{2}$/.test(body.start_time ?? "")) {
		errors.push("La hora de inicio no es válida.");
	}
	for (const key of FIELDS) {
		if (!String(body[key] ?? "").trim()) errors.push(`El campo ${key} es obligatorio.`);
	}
	return errors;
}

const app = express();
app.disable("x-powered-by");
app.use(express.urlencoded({ extended: false }));

app.get("/", (_req, res) => {
	const settings = getSettings();
	res.type("html").send(render(landingTemplate, { ...settings, ...deriveLabels(settings) }));
});

app.get("/cronograma", requireAuth, (req, res) => {
	const settings = getSettings();
	res.type("html").send(
		render(adminTemplate, {
			...settings,
			...deriveLabels(settings),
			notice: req.query.saved === "1" ? "Cambios guardados." : "",
			errors: "",
		}),
	);
});

app.post("/cronograma", requireAuth, (req, res) => {
	const errors = validate(req.body);
	if (errors.length) {
		const draft = Object.fromEntries(FIELDS.map((key) => [key, req.body[key] ?? ""]));
		return res.status(400).type("html").send(
			render(adminTemplate, {
				...draft,
				...deriveLabels(draft),
				notice: "",
				errors: errors.join(" "),
			}),
		);
	}
	saveSettings(req.body);
	res.redirect(303, "/cronograma?saved=1");
});

app.use(express.static(LANDING_DIR, { index: false, maxAge: "1h" }));

app.listen(PORT, () => {
	console.log(`Landing listening on http://localhost:${PORT}`);
});
