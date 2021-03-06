const Koa = require("koa");
const yn = require("yn");
const path = require("path");
const _ = require("lodash");
const moment = require("moment");
const logger = require("koa-logger");
const staticCache = require("koa-static-cache");
const body = require("koa-body");
const debug = require("debug")("doodoo");
const dotenv = require("./dotenv/main");
const Hook = require("./core/hook");
const Model = require("./core/model");
const Router = require("./core/router");
const Redis = require("./core/redis");
const _global = require("./global");
const _context = require("./context");
const Controller = require("./core/controller");
const { notifyError } = require("./core/error");
const pkg = require("./../package.json");

// 加载配置
dotenv.config({
    path: path.resolve(__dirname, "..", ".env")
});
dotenv.config();
dotenv.config({
    path: `${process.env.NODE_ENV}.env`
});

debug("process.env %O", process.env);

// 全局加载
global.doodoo = _global;

/**
 * Class Application
 */
module.exports = class Application extends Koa {
    /**
     * Create a application.
     * @param {object} options - Options
     * @param {string} options.root - App root path
     * @param {string} options.router - App router
     */
    constructor(options = {}) {
        super(options);

        // 加载全局变量
        doodoo = Object.assign(this, _global);
        Object.assign(this.context, _context);

        // this = new Koa();
        this.useBody = false;
        this.useCore = false;
        this.options = options;
        this.notifyError = notifyError;
        this.start_at = new Date();

        // error
        this.on("error", this.notifyError);

        // step 1
        this.use(async (ctx, next) => {
            const start = Date.now();

            await next();

            ctx.set("X-Powered-By", "doodoo.js");
            ctx.set("X-Response-Time", `${Date.now() - start}ms`);
        });
        this.use(logger());
    }

    /**
     * Core loader
     */
    core() {
        this.useCore = true;
        // model
        const model = new Model(this.options);
        this.models = model.loadModels();
        this.model = model => {
            return doodoo.models[model];
        };
        debug("models %O", this.models);

        // hook
        this.hook = new Hook(this.options);
        debug("hooks %O", this.hook);

        // redis
        if (yn(process.env.REDIS)) {
            this.redis = new Redis().getRedis();
        }

        // router
        this.Controller = Controller;
        this.router = new Router(
            Object.assign(this.options, {
                router: this.options.router
            })
        ).loadRouters();
        debug("router %O", this.router);
    }

    /**
     * Use a plugin
     * @description The plugin to add. If you provide a string it can
     *    represent a built-in plugin. You can also pass a function as argument to add it as a
     *    plugin.
     */
    plugin(plugin, options) {
        if (!this.useCore) {
            this.core();
        }
        if (_.isString(plugin)) {
            require("./plugin/" + plugin)(options);
        }
        if (_.isFunction(plugin)) {
            plugin(options);
        }
    }

    /**
     * Use express middleware
     * @param {*} fn
     */
    useExpress(fn) {
        this.use(_global.expressMiddlewareToKoaMiddleware(fn));
    }

    /**
     * Use a body middleware
     * @description The middleware is finally loaded by default, which can be manually invoked.
     */
    body() {
        // step 2
        this.useBody = true;
        this.use(async (ctx, next) => {
            await body({ multipart: true })(ctx, async () => {
                if (!ctx.request.body.files) {
                    ctx.post = ctx.request.body;
                } else {
                    ctx.post = ctx.request.body.fields;
                    ctx.file = ctx.request.body.files;
                }
            });

            await next();
        });
    }

    /**
     * Start a server
     * @returns {Server} http.createServer
     */
    async start() {
        // step 3
        if (!this.useCore) {
            this.core();
        }
        if (!this.useBody) {
            this.body();
        }
        this.use(this.router.routes());
        this.use(this.router.allowedMethods());
        this.use(
            staticCache(process.env.STATIC_DIR, {
                maxAge: process.env.STATIC_MAXAGE,
                dynamic: process.env.STATIC_DYNAMIC
            })
        );

        // context
        Object.assign(this.context, doodoo);

        return (this.server = this.listen(process.env.APP_PORT, this.started));
    }

    async started() {
        // 执行钩子
        await doodoo.hook.run("started");

        console.log(`[doodoo] Version: ${pkg.version}`);
        console.log(`[doodoo] Website: ${process.env.APP_HOST}`);
        console.log(`[doodoo] Nodejs Version: ${process.version}`);
        console.log(
            `[doodoo] Nodejs Platform: ${process.platform} ${process.arch}`
        );
        console.log(
            `[doodoo] Server Enviroment: ${process.env.NODE_ENV ||
                "development"}`
        );
        console.log(
            `[doodoo] Server Startup Time: ${moment().diff(doodoo.start_at)}ms`
        );
        console.log(
            `[doodoo] Server Current Time: ${moment().format(
                "YYYY-MM-DD HH:mm:ss"
            )}`
        );
        console.log(
            `[doodoo] Server Running At: http://127.0.0.1:${
                process.env.APP_PORT
            }`
        );
    }
};
