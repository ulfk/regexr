// imports
const gulp = require("gulp");
const inject = require("gulp-inject");
const rename = require("gulp-rename");
import template  from "gulp-template";
const sass = require("gulp-sass")(require('sass'));
const cleanCSS = require("gulp-clean-css");
const htmlmin = require("gulp-htmlmin");
const svgstore = require("gulp-svgstore");
const svgmin = require("gulp-svgmin");
import autoprefixer from 'gulp-autoprefixer';
const rollup = require("rollup").rollup;
const babel = require("@rollup/plugin-babel");
import terser from '@rollup/plugin-terser'
const replace = require("@rollup/plugin-replace");
const browser = require("browser-sync");
const Vinyl = require("vinyl");
const Buffer = require("buffer").Buffer;
const del = require("del");
const Readable = require("stream").Readable;
const createHash = require("crypto").createHash;
const fs = require("fs");
const basename = require("path").basename;

let js_file = "regexr.js";
let css_file = "regexr.css";

// constants
const isProduction = () => process.env.NODE_ENV === "production";
const pkg = require("./package.json");
const babelPlugin = babel({
	presets: [["@babel/env", {modules: false}]],
	babelrc: false
});
const replacePlugin = replace({
	delimiters: ["<%= ", " %>"],
	"build_version": pkg.version,
	"build_date": getDateString()
});
const themes = fs.readdirSync("./dev/sass").filter(f => /colors_\w+\.scss/.test(f)).map(t => getThemeFromPath(t));
const terserPlugin = terser();
let bundleCache;

const serverCopyAndWatchGlob = [
	"index.php", "server/**",
	"!server/**/composer.*",
	"!server/**/*.sql",
	"!server/**/*.md",
	"!server/gulpfile.js",
	"!server/Config*.php",
	"!server/**/*package*.json",
	"!server/{.git*,.git/**}",
	"!server/node_modules/",
	"!server/node_modules/**",
];

// tasks
gulp.task("serve", () => {
	browser({
		server: { baseDir: "./deploy/" },
	});
});

gulp.task("watch", () => {
	gulp.watch("./dev/src/**/*.js", gulp.series("js", "browserreload"));
	gulp.watch("./index.html", gulp.series("dev-html", "browserreload"));
	gulp.watch("./dev/icons/*.svg", gulp.series("icons"));
	gulp.watch("./dev/inject/*", gulp.series("inject", "browserreload"));
	gulp.watch("./dev/sass/**/*.scss", gulp.series("sass"));
});

gulp.task("browserreload", (done) => {
	browser.reload();
	done();
});

gulp.task("watch-server", () => {
	return gulp.watch(serverCopyAndWatchGlob, gulp.series("copy-server"));
});

gulp.task("js", () => {
	const plugins = [babelPlugin, replacePlugin];
	if (isProduction()) { plugins.push(terserPlugin); }
	return rollup({
		input: "./dev/src/app.js",
		cache: bundleCache,
		moduleContext: {
			"./dev/lib/codemirror.js": "window",
			"./dev/lib/clipboard.js": "window",
			"./dev/lib/native.js": "window"
		},
		plugins,
		onwarn: (warning, warn) => {
			// ignore circular dependency warnings
			if (warning.code === "CIRCULAR_DEPENDENCY") { return; }
			warn(warning);
		}
	}).then(bundle => {
		bundleCache = bundle.cache;
		return bundle.write({
			format: "iife",
			file: `./deploy/${js_file}`,
			name: "regexr",
			sourcemap: !isProduction()
		})
	});
});

// create tasks for all themes
themes.forEach(theme => {
	gulp.task(`sass-${theme}`, () => {
		return diffTheme(theme).then(() => {
			return gulp.src(`./assets/themes/${theme}.css`)
				.pipe(browser.stream());
		})
	});
});

// render all themes
gulp.task("sass-themes", gulp.parallel(themes.map(theme => `sass-${theme}`)));

const defaultSass = () => {
	const str = buildSass("default")
		.pipe(rename(css_file))
		.pipe(gulp.dest("deploy"));

	return isProduction()
		? str
		: str.pipe(browser.stream());
};
defaultSass.displayName = "sass-default";

gulp.task("sass", gulp.series(defaultSass, "sass-themes"));

gulp.task("html", () => {
	return gulp.src("./index.html")
		.pipe(template({
			js_file,
			css_file,
		}))
		.pipe(htmlmin({
			collapseWhitespace: true,
			conservativeCollapse: true,
			removeComments: true
		}))
		.pipe(gulp.dest("build"));
});

gulp.task("dev-html", () => {
	return gulp.src("./index.html")
		.pipe(template({
			js_file,
			css_file,
		}))
		.pipe(htmlmin({
			collapseWhitespace: true,
			conservativeCollapse: true,
			removeComments: true
		}))
		.pipe(gulp.dest("deploy"));
});


gulp.task("createFileHashes", (cb) => {
	const js_version = createFileHash(`deploy/regexr.js`);
	const css_version = createFileHash("deploy/regexr.css");
	js_file = `deploy/${js_version}.js`;
	css_file = `deploy/${css_version}.css`;
	cb();
});

gulp.task("icons", () => {
	return gulp.src("dev/icons/*.svg")
		// strip fill attributes and style tags to facilitate CSS styling:
		.pipe(svgmin({
			plugins: [
				{removeAttrs: {attrs: "fill"}},
				{removeStyleElement: true},
				{removeViewBox: false},
			]}
		))
		.pipe(svgstore({inlineSvg: true}))
		.pipe(gulp.dest("dev/inject"));
});

gulp.task("inject", () => {
	return gulp.src("index.html")
		.pipe(inject(gulp.src("dev/inject/*"), {
			transform: (path, file) => {
				const tag = /\.css$/ig.test(path) ? "style" : "";
				return (tag ? `<${tag}>` : "") + file.contents.toString() + (tag ? `</${tag}>` : "");
			}
		}))
		.pipe(gulp.dest("."));
});

gulp.task("clean", () => {
	return del([
		"build/**",
		"!build",
		"!build/sitemap.txt",
		"!build/{.git*,.git/**}",
		"!build/v1/**"
	]);
});

gulp.task("copy", () => {
	// index.html is copied in by the html task
	return gulp.src([
		"deploy/**",
		"assets/**",
		"!deploy/*.map",
		...serverCopyAndWatchGlob
	], {base: "./"})
	.pipe(gulp.dest("./build/"));
});

gulp.task("copy-server", () => {
	// index.html is copied in by the html task
	return gulp.src(serverCopyAndWatchGlob, {base: "./"})
	.pipe(gulp.dest("./build/"));
});

gulp.task("rename-css", () => {
	return gulp.src("./build/deploy/regexr.css")
		.pipe(rename(basename(css_file)))
		.pipe(gulp.dest("./build/deploy/"));
});

gulp.task("rename-js", () => {
	return gulp.src("./build/deploy/regexr.js")
		.pipe(rename(basename(js_file)))
		.pipe(gulp.dest("./build/deploy/"));
});

gulp.task("clean-build", () => {
	return del([
		"./build/deploy/regexr.*",
	]);
})

gulp.task("build", gulp.parallel("js", "sass"));
gulp.task("server", gulp.series("copy-server", "watch-server"));
gulp.task("rename", gulp.parallel("rename-css", "rename-js"));

gulp.task("default",
	gulp.series("build","dev-html",
		gulp.parallel("serve", "watch")
	)
);

gulp.task("deploy",
	gulp.series(
		cb => (process.env.NODE_ENV = "production") && cb(),
		"clean", "build", "createFileHashes", "html", "copy", "rename", "clean-build"
	)
);

// helpers
function createFileHash(filename) {
	const hash = createHash("sha256");
	const fileContents = fs.readFileSync(filename, "utf-8");
	hash.update(fileContents);
	return hash.digest("hex").slice(0, 9);
}

function getDateString() {
	const now = new Date();
	const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
	return `${months[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()}`;
}

// theme "default", "light", "dark"
function buildSass(theme) {
	// read (s)css dependencies for the temp file
	const libs = fs.readdirSync("./dev/lib").filter(file => /\.s?css$/.test(file));
	const base = "./dev/sass/";
	// sass file that is piped into the stream from memory
	const tmpSass = `
		${libs.map(f => `@import "../lib/${basename(f)}";`).join("\n")}
		@import "./colors${theme === "default" ? "" : "_" + theme}.scss";
		@import "./regexr.scss";
	`;
	const tmpFile = new Vinyl({
		cwd: "/",
		base,
		path: `${base + theme}.scss`,
		contents: Buffer.from(tmpSass)
	});
	// open an object stream and read the vinyl file in, piping thru the sass compilation
	const src = Readable({ objectMode: true });
	src._read = () => {
		src.push(tmpFile);
		src.push(null); // required for gulp to close properly
	};
	return src
		.pipe(sass().on("error", sass.logError))
		.pipe(autoprefixer({remove: false}))
		.pipe(cleanCSS());
}

function diffTheme(theme) {
	const css = {};
	return Promise.all(
		// render both the default styles and the theme styles, saving the results
		["default", theme].map(type => new Promise((resolve, reject) => {
			buildSass(type).on("data", file => {
				css[type] = file.contents.toString();
				resolve();
			});
		}))
	).then(() => new Promise((resolve, reject) => {
		// diff the results, writing the results as the theme to override defaults
		const diff = (new CSSDiff()).diff(css.default, css[theme]);
		fs.writeFile(`./assets/themes/${theme}.css`, diff, resolve);
	}));
}

function getThemeFromPath(filename) {
	return filename.match(/_(\w+)\.scss/)[1];
}

class CSSDiff {
	diff(base, targ, pretty = false) {
		let diff = this.compare(this.parse(base), this.parse(targ));
		return this._writeDiff(diff, pretty);
	}

	parse(s, o = {}) {
		this._parse(s, /([^\n\r\{\}]+?)\s*\{\s*/g, /\}/g, o);
		for (let n in o) {
			if (n === " keys") { continue; }
			o[n] = this.parseBlock(o[n]);
		}
		return o;
	}

	parseBlock(s, o = {}) {
		return this._parse(s, /([^\s:]+)\s*:/g, /(?:;|$)/g, o);
	}

	compare(o0, o1, o = {}) {
		let keys = o1[" keys"], l=keys.length, arr=[];
		for (let i=0; i<l; i++) {
			let n = keys[i];
			if (!o0[n]) { o[n] = o1[n]; arr.push(n); continue; }
			let diff = this._compareBlock(o0[n], o1[n]);
			if (diff) { o[n] = diff; arr.push(n); }
		}
		o[" keys"] = arr;
		return o;
	}

	_compareBlock(o0, o1) {
		let keys = o1[" keys"], l=keys.length, arr=[], o;
		for (let i=0; i<l; i++) {
			let n = keys[i];
			if (o0[n] === o1[n]) { continue; }
			if (!o) { o = {}; }
			o[n] = o1[n];
			arr.push(n);
		}
		if (o) { o[" keys"] = arr; }
		return o;
	}

	_parse(s, keyRE, closeRE, o) {
		let i, match, arr=[];
		while (match = keyRE.exec(s)) {
			let key = match[1];
			i = closeRE.lastIndex = keyRE.lastIndex;
			if (!(match = closeRE.exec(s))) { console.log("couldn't find close", key); break; }
			o[key] = s.substring(i, closeRE.lastIndex-match[0].length).trim();
			i = keyRE.lastIndex = closeRE.lastIndex;
			arr.push(key);
		}
		o[" keys"] = arr;
		return o;
	}

	_writeDiff(o, pretty = false) {
		let diff = "", ln="\n", s=" ";
		if (!pretty) { ln = s = ""; }
		let keys = o[" keys"], l=keys.length;
		for (let i=0; i<l; i++) {
			let n = keys[i];
			if (diff) { diff += ln + ln; }
			diff += n + s + "{" + ln;
			diff += this._writeBlock(o[n], pretty);
			diff += "}";
		}
		return diff;
	}

	_writeBlock(o, pretty = false) {
		let diff = "", ln="\n", t="\t", s=" ";
		if (!pretty) { ln = t = s = ""; }
		let keys = o[" keys"], l=keys.length;
		for (let i=0; i<l; i++) {
			let n = keys[i];
			diff += t + n + ":" + s + o[n] + ";" + ln;
		}
		return diff;
	}
}
