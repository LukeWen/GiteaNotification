module.exports = {
    apps: [{
        name: "gitea-notifier",
        script: "./src/index.js",
        watch: false,
        env: {
            NODE_ENV: "production",
            PORT: 5120
        }
    }]
}
