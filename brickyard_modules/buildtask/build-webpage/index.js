'use strict'

const _ = require('lodash')
const gulp = require('gulp')
const brickyard = require('brickyard')

const temp_lib_dir = `${brickyard.dirs.temp}/lib`

// atomic tasks
gulp.create_tasks({
	/**
	 * 将前端插件内对应的资源复制到临时目录
	 */
	build_frontend_plugins_temp: function () {
		let streams = []
		_.each(brickyard.modules.frontend, function (plugin, id) {
			let _path = []
			_path.push(`${plugin.path}/**/*.{js,es6,es7,json,md,html,css,scss,map,gif,jpg,jpeg,png,ico,svg,ttf,eot,woff,woff2,xsd,wsdl,mp3,wav}`)
			_path.push(`!${plugin.path}/**/node_modules/**`)
			_path.push(`!${plugin.path}/**/bower_components/**`)
			_path.push(`!${plugin.path}/**/server/**`)

			let stream = gulp.src(_path)
				.pipe(gulp.dest(`${brickyard.dirs.tempModules}/${id}`))
			streams.push(stream)
		})

		if (streams.length) {
			return gulp.merge(streams)
		}
	},
	/**
	 * 将 bower component 的相关资源文件复制到临时目录下
	 */
	build_bower_temp: function () {
		let rc = [
			`${brickyard.dirs.dest}/bower_components/jquery/dist/jquery.min.js`, // for admin shop plugin
			`${brickyard.dirs.dest}/bower_components/**/*.{gif,jpg,jpeg,png,ico,css,map,sass,scss}`,
			`${brickyard.dirs.dest}/bower_components/**/fonts/**`,
			`!${brickyard.dirs.dest}/bower_components/**/@(example|examples|docs|test|dev){,/**}`,
		]
		return gulp.src(rc, { base: brickyard.dirs.bower })
			.pipe(gulp.plugins.changed(temp_lib_dir))
			.pipe(gulp.dest(temp_lib_dir))
	},
	/**
	 * 解决 angular-strap 与 angular-bootstrap 的 部分服务冲突
	 * 随着 angular-bootstrap 升级到 1.0.0 此问题已无效
	 *
	 * todo: update to angular-bootstrap 1.0.0
	 * @returns {*}
	 */
	fix_angular_strap: function () {
		return gulp.src(`${brickyard.dirs.bower}/angular-strap/dist/angular-strap.js`)
			.pipe(gulp.plugins.ngAnnotate({
				add: true,
				remove: true,
				rename: [
					{ from: '$tooltip', to: '$asTooltip' },
					{ from: '$button', to: '$asButton' },
					{ from: '$modal', to: '$asModal' }]
			}))
			.pipe(gulp.dest(`${brickyard.dirs.bower}/angular-strap/fix`))
	},
	/**
	 * 清空临时目录
	 * @param cb
	 */
	clean_temp: function (cb) {
		if (!brickyard.argv.debug && !brickyard.argv.watch) {
			gulp.del.sync([brickyard.dirs.temp, brickyard.dirs.bower])
		}

		cb()
	}
})

// composed tasks
gulp.create_tasks({
	'build-webpage': function (cb) {
		gulp.run_sequence('build_bower_temp', 'fix_angular_strap', 'build_frontend_plugins_temp', cb)
	}
})

//21.build-babel, 22.build-style-scss, 23.build-style-minify, 24.build-misc
//25.webpack-config, 26.webpack-build
gulp.register_sub_tasks('build', 20, 'build-webpage')
gulp.register_sub_tasks('build', 40, 'clean_temp')