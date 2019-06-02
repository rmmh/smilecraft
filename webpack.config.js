const path = require('path');

const CopyPlugin = require('copy-webpack-plugin');

module.exports = {
    mode: 'development',
    entry: './web/main.ts',
    devtool: 'source-map',
    module: {
        rules: [{
            test: /\.tsx?$/,
            use: 'ts-loader',
            exclude: /node_modules/
        }]
    },
    resolve: {
        extensions: ['.tsx', '.ts', '.js']
    },
    output: {
        filename: 'bundle.js',
        path: path.resolve(__dirname, 'dist')
    },
    plugins: [
        new CopyPlugin([{
                from: 'web/*.html',
                flatten: true
            },
            'data/emoji.json',
            {
                from: 'data/emoji_svgs_*.css',
                flatten: true
            },
            {
                from: 'noto-emoji/png/128/emoji_u1f3ed.png',
                to: 'favicon.ico'
            }
        ])
    ],
};
