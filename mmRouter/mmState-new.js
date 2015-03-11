define("mmState", ["../mmPromise/mmPromise", "mmRouter/mmRouter"], function() {
//重写mmRouter中的route方法     
    avalon.router.route = function(method, path, query, options) {
        path = path.trim()
        var states = this.routingTable[method]
        for (var i = 0, el; el = states[i++]; ) {//el为一个个状态对象，状态对象的callback总是返回一个Promise
            var args = path.match(el.regexp)
            if (args && el.abstract !== true) {//不能是抽象状态
                var newParams = {params: {}}
                avalon.mix(newParams.params, el.params)
                newParams.keys = el.keys
                newParams.params.query = query || {}
                args.shift()
                if (el.keys.length) {
                    this._parseArgs(args, newParams)
                }
                if (el.stateName) {
                    mmState.transitionTo(mmState.currentState, el, newParams.params, options)
                } else {
                    el.callback.apply(el, args)
                }
                return
            }
        }
        if (this.errorback) {
            this.errorback()
        }
    }
    var _root, undefine
    /*
     *  @interface avalon.router.go 跳转到一个已定义状态上，params对参数对象
     *  @param toName 状态name
     *  @param params 附加参数
     *  @param params.query 在hash后面附加的类似search'的参数对
     *  @param options 扩展配置
     *  @param options.reload true强制reload，即便url、参数并未发生变化
     *  @param options.replace true替换history，否则生成一条新的历史记录
     *  @param options.replaceQuery true表示完全覆盖query，而不是merge，默认为false，为true则会用params指定的query去清空
    */
    avalon.router.go = function(toName, params, options) {
        var from = mmState.currentState, 
            to = StateModel.is(toName) ? toName : getStateByName(toName), 
            replaceQuery =  options && options.replaceQuery, 
            params = params || {}
        params = avalon.mix(true, {}, to.params, params)
        if (to) {
            mmState.transitionTo(from, to, params, options)
        }
    }
    // 事件管理器
    var Event = window.$eventManager = avalon.define("$eventManager", function(vm) {
        vm.$flag = 0;
        vm.uiqKey = function() {
            vm.$flag++
            return "flag" + vm.$flag++
        }
    })
    Event.$watch("onload", function(e) {
        var _onloadCallback = mmState._onloadCallback
        mmState._onloadCallback = {}
        for(var i in _onloadCallback) {
            _onloadCallback[i].apply(arguments[0], [].slice.call(arguments, 2))
        }
    })
    function removeOld() {
        var nodes = mmState.oldNodes
        while(nodes.length) {
            var i = nodes.length - 1,
                node = nodes[i]
            node.parentNode && node.parentNode.removeChild(node)
            nodes.splice(i, 1)
        }
    }
    Event.$watch("abort", removeOld)
    var mmState = window.mmState = {
        prevState: NaN,
        currentState: NaN, // 当前状态，可能还未切换到该状态
        activeState: NaN, // 当前实际处于的状态
        oldQuery: {},
        query: {},
        _local: {},
        oldNodes: [],
        _onloadCallback: {},
        addCallback: function(key, func) {
            if(!this._onloadCallback[key]) this._onloadCallback[key] = func
        },
        removeCallback: function(key) {
            this._onloadCallback[key] = avalon.noop
        },
        // params changed
        isParamsChanged: function(p, op) {
            var isQuery = p == void 0,
                p = isQuery ? this.query : p,
                op = isQuery ? this.oldQuery : op,
                res = false
            for(var i in p) {
                if(!(i in op) || op[i] != p[i]) {
                    res = true
                    break
                }
            }
            if(!res) {
                for(var i in op) {
                    if(!(i in p) || op[i] != p[i]) {
                        res = true
                        break
                    }
                }
            }
            return res
        },
        // 状态离开
        popState: function(end, params, callback) {
            callback = callback || avalon.noop
            if(!this.activeState || end === this.activeState) return callback()
            this.popOne(end, params, callback)
        },
        popOne: function(end, params, callback) {
            var cur = this.activeState, me = this
            if(end === this.activeState || cur == _root) return callback()
            // 阻止退出
            if(cur.onBeforeUnload() === false) return callback(false)
            // 如果没有父状态了，说明已经退出到最上层，需要退出，不再继续迭代
            me.activeState = cur.parentState || _root
            cur.done = function(success) {
                cur._pending = false
                cur.done = null
                if(success !== false) {
                    if(me.activeState) return me.popOne(end, params, callback)
                }
                return callback(success)
            }
            var success = cur.onAfterUnload()
            if(!cur._pending && cur.done) cur.done(success)
        },
        // 状态进入
        pushState: function(end, params, callback){
            callback = callback || avalon.noop
            var active = this.activeState
            // 切换到目标状态
            if(active == end) return callback()
            var chain = [] // 状态链
            while(end !== active && end != _root){
                chain.push(end)
                var tmp = end
                end = end.parentState
            }
            // 逐一迭代
            this.pushOne(chain, params, callback)
        },
        pushOne: function(chain, params, callback) {
            var cur = chain.pop(), me = this
            // 退出
            if(!cur) return callback()
            cur.syncParams(params)
            // 阻止进入该状态
            if(cur.onBeforeChange() === false) {
                // 恢复params
                avalon.mix(true, cur.params, cur.oldParams)
                return callback(false)
            }
            me.activeState = cur // 更新当前实际处于的状态
            cur.done = function(success) {
                // 防止async处触发已经销毁的done
                if(!cur.done) return
                cur._pending = false
                cur.done = null
                cur.visited = true
                // 退出
                if(success === false) {
                    // 这里斟酌一下
                    cur.callback.apply(cur, params)
                    return callback(success)
                }
                new Promise(function(resolve) {
                    resolve()
                }).then(function() {
                    // view的load，切换以及scan
                    return cur.callback.apply(cur, params)
                }).done(function() {
                    // sync params to oldParams
                    avalon.mix(true, cur.oldParams, cur.params)
                    cur.parentState.fire("updateview", cur)
                    // 继续状态链
                    me.pushOne(chain, params, callback)
                })
            }
            // 一般在这个回调里准备数据
            var args = []
            avalon.each(cur.keys, function(index, item) {
                var key = item.name
                args.push(cur.params[key])
            })
            cur._onChange.apply(cur, args)
            if(!cur._pending && cur.done) cur.done()
        },
        transitionTo: function(fromState, toState, toParams, options) {
            var toParams = toParams || toState.params, fromAbort
            // state machine on transition
            if(this.activeState && (this.activeState != this.currentState)) {
                avalon.log("navigating to [" + 
                    this.currentState.stateName + 
                    "] will be stopped, redirect to [" + 
                    toState.stateName + "] now")
                this.activeState.done && this.activeState.done(!"stopped")
                fromState = this.activeState // 更新实际的fromState
                fromAbort = true
            }

            var info = avalon.router.urlFormate(toState.url, toParams, toParams.query),
                me = this,
                options = options || {},
                // 是否强制reload或者query发生变化，参照angular，这个时候会触发整个页面重刷
                reload = options.reload || this.isParamsChanged(),
                over,
                // 找共同的父节点，那么也是需要参考params和reload，reload情况，将所有栈里的state全部退出，否则退出到params没有发生变化的地方
                commonParent = _root
                if(!reload) {
                    commonParent = findCommonBranch(fromState, toState, toParams)
                }
                done = function(success) {
                    if(over) return
                    over = true
                    me.currentState = me.activeState
                    if(success !== false) {
                        avalon.log("transitionTo " + toState.stateName + " success")
                        callStateFunc("onload", me, fromState, toState)
                    } else if(options.fromHistory){
                        var cur = me.currentState
                        info = avalon.router.urlFormate(cur.url, cur.params, mmState.query)
                    } else {
                        info = null 
                    }
                    if(info && avalon.history) avalon.history.updateLocation(info.path + info.query, avalon.mix({}, options, {silent: true}))
                }
            toState.path = ("/" + info.path).replace(/^[\/]{2,}/g, "/")
            if(!reload && fromState === toState) {
                if(!toState.paramsChanged(toParams)) {
                    // redirect的目的状态 == this.activeState && abort
                    if(toState == this.activeState && fromAbort) return done()
                    // 重复点击直接return
                    return
                }
            }
            if(callStateFunc("beforeUnload", this, fromState, toState) === false) {
                if(fromState) done(false)
                return callStateFunc("abort", this, fromState, toState)
            }
            if(over === true) {
                return
            }
            avalon.log("begin transitionTo " + toState.stateName + " from " + (fromState && fromState.stateName || "unknown"))
            callStateFunc("unload", this, fromState, toState)
            this.currentState = toState
            this.prevState = fromState
            callStateFunc("begin", this, fromState, toState)
            this.popState(commonParent, toParams, function(success) {
                // 中断
                if(success === false) return done(success)
                me.pushState(toState, toParams, done)
            })
        }
    }
    //【avalon.state】的辅助函数，用于收集可用于扫描的vmodels
    function getVModels(opts) {
        var array = []
        function getVModel(opts, array) {
            var ctrl = opts.controller
            if (avalon.vmodels[ctrl]) {
                avalon.Array.ensure(array, avalon.vmodels[ctrl])
            }
            if (opts.parentState) {
                getVModel(opts.parentState, array)
            }
        }
        getVModel(opts, array)
        return array
    }
    //将template,templateUrl,templateProvider,onBeforeLoad,onAfterLoad这五个属性从opts对象拷贝到新生成的view对象上的
    function copyTemplateProperty(newObj, oldObj, name) {
        newObj[name] = oldObj[name]
        delete  oldObj[name]
    }
    function viewAnimate(oldNode, topCtrlName, statename, me) {
        var $node = avalon(oldNode)
        if($node.hasClass("oni-mmRouter-slide")) {
            var node = oldNode.cloneNode(true)
            avalon(node).addClass("oni-mmRouter-enter")
            $node.addClass("oni-mmRouter-leave")
            oldNode.removeAttribute("ms-view")
            avalon.each(getViews(topCtrlName, statename, oldNode), function(i, n) {
                n.removeAttribute("ms-view")
            })
            oldNode.parentNode.insertBefore(node, oldNode.nextSibling)
            callStateFunc("onViewEnter", me, node, oldNode)
            return node
        }
        return oldNode
    }

    // 靠谱的解决方法
    var count = 0
    avalon.bindingHandlers.view = function(data, vmodels) {
        var element = data.element,
            $element = avalon(element),
            viewname = data.value,
            comment = document.createComment("ms-view:" + viewname),
            par = element.parentNode,
            defaultHTML = element.innerHTML,
            statename = $element.data("statename") || "",
            state = getStateByName(statename) || _root
        if (viewname.indexOf('@') < 0) viewname += '@' + (state.parentState ? state.parentState.stateName || "" : "")
        if(!state) return
        par.insertBefore(comment, element)
        function update(firsttime, state) {
            if(!comment.parentNode) return !"delete from watch"
            var state = mmState.currentState, _local,
                statename = $element.data("statename") || "",
                state = getStateByName(statename) || state || _root
            if(state === _root) return
            if (viewname.indexOf('@') < 0) viewname += '@' + (state.parentState ? state.parentState.stateName || "" : "")
            if(firsttime && state && !state.resolve) return
            var _state = state
            while(_local === undefine && _state != _root) {
                if(viewname in _state._local) {
                    _local = _state._local[viewname]
                    break
                }
                _state = _state.parentState
            }
            count++
            // if(count > 20) return
            var a = 1
            element.innerHTML = _local === undefine ? defaultHTML : _local.template
            element.removeAttribute("ms-view")
            element.setAttribute("ui-view", data.value)
            var me = state
            avalon.each(getViewNodes(element), function(i, node) {
                // if(node.tagName === "TD") debugger
                avalon(node).data("statename", me.stateName)
            })
            var vm = getVModels(state)
            avalon.scan(element, vm)
        }
        update("firsttime")
        state.watch("updateview", function(state) {
            update.call(this, undefine, state)
        })
    }
    function renderView(element) {
        var defaultHTML = element.innerHTML
        return function() {
            var currentState = mmState.currentState,
                name = "",
                _local = currentState._local && currentState._local[name]
            if(_local === void 0) return
            element.innerHTML = _local || defaultHTML
        }
    }
    /*
     * @interface avalon.state 对avalon.router.get 进行重新封装，生成一个状态对象
     * @param stateName： 指定当前状态名
     * @param opts 配置
     * @param opts.url:  当前状态对应的路径规则，与祖先状态们组成一个完整的匹配规则
     * @param opts.controller： 指定当前所在的VM的名字（如果是顶级状态对象，必须指定）
     * @param opts.views: 如果不写views属性,则默认view为""，对多个[ms-view]容器进行处理,每个对象应拥有template, templateUrl, templateProvider
     * @param opts.views.template 指定当前模板，也可以为一个函数，传入opts.params作参数
     * @param opts.views.templateUrl 指定当前模板的路径，也可以为一个函数，传入opts.params作参数
     * @param opts.views.templateProvider 指定当前模板的提供者，它可以是一个Promise，也可以为一个函数，传入opts.params作参数
     *     views的结构为
     *<pre>
     *     {
     *        "": {template: "xxx"}
     *        "aaa": {template: "xxx"}
     *        "bbb@": {template: "xxx"}
     *     }
     *</pre>
     *     views的每个键名(keyname)的结构为viewname@statename，
     *         如果名字不存在@，则viewname直接为keyname，statename为opts.stateName
     *         如果名字存在@, viewname为match[0], statename为match[1]
     * @param opts.onBeforeLoad 模板还没有插入DOM树执行的回调，this指向[ms-view]元素节点集合，参数为关联的state对象
     * @param opts.onAfterLoad 模板插入DOM树执行的回调，this指向[ms-view]元素节点，参数为为关联的state对象
     * @param opts.onBeforeChange 切入某个state之前触发，this指向对应的state，如果return false则会中断并退出整个状态机
     * @param opts.onChange 当切换为当前状态时调用的回调，this指向状态对象，参数为匹配的参数， 我们可以在此方法 定义此模板用到的VM， 或修改VM的属性
     * @param opts.onBeforeUnload state退出前触发，this指向对应的state，如果return false则会中断并退出整个状态机
     * @param opts.onAfterUnload 退出后触发，this指向对应的state
     * @param opts.abstract  表示它不参与匹配，this指向对应的state
     * @param {private} opts.parentState 父状态对象（框架内部生成）
     */
    avalon.state = function(stateName, opts) {
        var state = StateModel(stateName, opts)
        avalon.router.get(state.url, function() {
            var vmodes = getVModels(state)
            var topCtrlName = vmodes[vmodes.length - 1]
            if (!topCtrlName) {
                avalon.log("topController不存在")
                return
            }
            if(state.resolved) return state.resolved
            var me = this, promises = []

            avalon.each(state.views, function(name, view) {
                var promise = fromPromise(view, me.params), 
                    warnings = "warning: " + stateName + "状态对象的【" + name + "】视图对象"
                promises.push(promise)
                promise.then(function(s) {
                    state._local[name] = {
                        template: s,
                        name: name,
                        vmodels: getVModels(state)
                    }
                }, function(msg) {
                    avalon.log(warnings + " " + msg)
                    callStateFunc("onloadError", me, name, state)
                })
                
            })
            state.resolved = Promise.all(promises).then(function(values) {
                getFn(state, "onAfterLoad").call(null, me)
            })
            return state.resolved

        }, state)

        return this
    }
    avalon.state.onViewEntered = function(newNode, oldNode) {
        if(newNode != oldNode) oldNode.parentNode.removeChild(oldNode)
    }
    /*
     *  @interface avalon.state.config 全局配置
     *  @param {Object} config 配置对象
     *  @param {Function} config.beforeUnload 开始切前的回调，this指向router对象，第一个参数是fromState，第二个参数是toState，return false可以用来阻止切换进行
     *  @param {Function} config.abort beforeUnload return false之后，触发的回调，this指向mmState对象，参数同beforeUnload
     *  @param {Function} config.unload url切换时候触发，this指向mmState对象，参数同beforeUnload
     *  @param {Function} config.begin  开始切换的回调，this指向mmState对象，参数同beforeUnload
     *  @param {Function} config.onload 切换完成并成功，this指向mmState对象，参数同beforeUnload
     *  @param {Function} config.onViewEnter 视图插入动画函数，有一个默认效果
     *  @param {Node} config.onViewEnter.arguments[0] 新视图节点
     *  @param {Node} config.onViewEnter.arguments[1] 旧的节点
     *  @param {Function} config.onloadError 加载模板资源出错的回调，this指向对应的state，第一个参数对应的模板配置keyname，第二个参数是对应的state
    */
    avalon.state.config = function(config) {
        avalon.mix(avalon.state, config || {})
        return this
    }
    function callStateFunc(name, state) {
        Event.$fire.apply(Event, arguments)
        return avalon.state[name] ? avalon.state[name].apply(state || mmState.currentState, [].slice.call(arguments, 2)) : 0
    }
    // 状态原型，所有的状态都要继承这个原型
    function StateModel(stateName, options) {
        if(this instanceof StateModel) {
            this.stateName = stateName
            this.formate(options)
        } else {
            return new StateModel(stateName, options || {})
        }
    }
    StateModel.is = function(state) {
        return state instanceof StateModel
    }
    StateModel.prototype = {
        formate: function(options) {
            avalon.mix(true, this, options)
            var stateName = this.stateName,
                me = this,
                chain = stateName.split("."),
                len = chain.length - 1
            this.chain = []
            avalon.each(chain, function(key, name) {
                if(key == len) {
                    me.chain.push(me)
                } else {
                    var n = chain.slice(0, key + 1).join("."),
                        state = getStateByName(n)
                    if(!state) throw new Error("必须先定义" + n)
                    me.chain.push(state)
                }
            })
            if (this.url === void 0) {
                this.abstract = true
            }
            var parent = this.chain[len - 1] || _root
            if (parent) {
                this.url = parent.url + (this.url || "")
                this.parentState = parent
            }
            if (!this.views) {
                var view = {}
                "template,templateUrl,templateProvider,onBeforeLoad,onAfterLoad".replace(/\w+/g, function(prop) {
                    copyTemplateProperty(view, me, prop)
                })
                this.views = {
                    "": view
                }
            }
            var views = {}
            avalon.each(this.views, function(name, view) {
                if (name.indexOf('@') < 0) name += '@' + (parent ? parent.stateName || "" : "")
                views[name] = view
            })
            this.views = views
            this._self = options
            this._pending = false
            this.visited = false
            this.params = {}
            this.oldParams = {}
            this.keys = []
            this._local = {}

            this.events = {}
        },
        watch: function(eventName, func) {
            var events = this.events[eventName] || []
            this.events[eventName] = events
            events.push(func)
        },
        fire: function(eventName, state) {
            var events = this.events[eventName] || [], i = 0
            while(events[i]) {
                var res = events[i].call(this, state)
                if(res === false) {
                    events.splice(i, 1)
                } else {
                    i++
                }
            }
        },
        paramsChanged: function(toParams) {
            var changed = false, keys = this.keys, me= this, params = this.params
            avalon.each(keys, function(index, item) {
                var key = item.name
                if(params[key] != toParams[key]) changed = true
            })
            return changed
        },
        syncParams: function(toParams) {
            var me = this
            avalon.each(this.keys, function(index, item) {
                var key = item.name
                if(key in toParams) me.params[key] = toParams[key]
            })
        },
        _onChange: function() {
            this.query = this.getQuery()
            this.onChange.apply(this, arguments)
        },
        /*
         * @interface state.getQuery 获取state的query，等价于state.query
         *<pre>
         *  onChange: function() {
         *      var query = this.getQuery()
         *      or
         *      this.query
         *  }
         *</pre> 
         */
        getQuery: function() {return mmState.query},
        /*
         * @interface state.getParams 获取state的params，等价于state.params
         *<pre>
         *  onChange: function() {
         *      var params = this.getParams()
         *      or
         *      this.params
         *  }
         *</pre> 
         */
        getParams: function() {return this.params},
        /*
         * @interface state.async 表示当前的状态是异步，中断状态chain的继续执行，返回一个done函数，通过done(false)终止状态链的执行，任意其他非false参数，将继续
         *<pre>
         *  onChange: function() {
         *      var done = this.async()
         *      setTimeout(done, 4000)
         *  }
         *</pre> 
        */
        async: function() {
            // 没有done回调的时候，防止死球
            if(this.done) this._pending = true
            return this.done || avalon.noop
        },
        onBeforeChange: avalon.noop, // 切入某个state之前触发
        onChange: avalon.noop, // 切入触发
        onBeforeLoad: avalon.noop, // 所有资源开始加载前触发
        onAfterLoad: avalon.noop, // 加载后触发
        onBeforeUnload: avalon.noop, // state退出前触发
        onAfterUnload: avalon.noop // 退出后触发
    }

    _root = StateModel("", {
        url: "",
        views: null,
        "abstract": true
    })
    window._root = _root
    //【avalon.state】的辅助函数，确保返回的是函数
    function getFn(object, name) {
        return typeof object[name] === "function" ? object[name] : avalon.noop
    }

    // find common parentState
    function findCommonBranch(fromState, toState, toParams) {
        if(!fromState || fromState === _root) return _root
        var fromChain = fromState && fromState.chain || [],
            toChain = toState.chain,
            i = 0,
            state = toChain[i]
        while(state && state === fromChain[i] && !state.paramsChanged(toParams)) {
            i++
            state = toChain[i]
        }
        return toChain[i - 1] || _root
    }
    
    function getStateByName(stateName) {
        var states = avalon.router.routingTable.get,
            state = NaN
        for (var i = 0, el; el = states[i++]; ) {
            if (el.stateName === stateName) {
                state = el
                break
            }
        }
        return state
    }
    function getViewNodes(node) {
        var nodes
        if(node.querySelectorAll) {
            nodes = node.querySelectorAll("[ms-view]")
        } else {
            nodes = Array.prototype.filter.call(node.getElementsByTagName("*"), function(node) {
                return typeof node.getAttribute("ms-view") === "string"
            })
        }
        return nodes
    }
    // 【avalon.state】的辅助函数，收集所有要渲染的[ms-view]元素
    function getViews(ctrl, name, node) {
        var v = avalon.vmodels[ctrl]
        var firstExpr = v && v.$events.expr || "[ms-controller=\"" + ctrl + "\"]"
        var otherExpr = [],
            node = node || document
        name.split(".").forEach(function() {
            otherExpr.push("[ms-view]")
        })
        if (node.querySelectorAll) {
            return node.querySelectorAll(firstExpr + " " + otherExpr.join(" "))
        } else {
            //DIV[avalonctrl="test"] [ms-view] 从右到左查找，先找到所有匹配[ms-view]的元素
            var seeds = Array.prototype.filter.call(node.getElementsByTagName("*"), function(node) {
                return typeof node.getAttribute("ms-view") === "string"
            })
            while (otherExpr.length > 1) {
                otherExpr.pop()
                seeds = matchSelectors(seeds, function(node) {
                    return typeof node.getAttribute("ms-view") === "string"
                })
            }
            //判定这些候先节点是否匹配[avalonctrl="test"]或[ms-controller="test"]
            seeds = matchSelectors(seeds, function(node) {
                return  node.getAttribute("avalonctrl") === ctrl ||
                        node.getAttribute("ms-controller") === ctrl
            })
            return seeds.map(function(el) {
                return el.node
            })
        }
    }
    function viewKey(node) {
        var kn = "view-id",
            key = node.getAttribute(kn)
        if(key) return key
        key = Event.uiqKey()
        node.setAttribute(kn, key)
        return key
    }
    // 【avalon.state】的辅助函数，从已有集合中寻找匹配[ms-view="viewname"]表达式的元素节点
    function getNamedView(nodes, viewname) {
        for (var i = 0, el; el = nodes[i++]; ) {
            if (el.getAttribute("ms-view") === viewname) {
                return el
            }
        }
    }
    // 【getViews】的辅助函数，从array数组中得到匹配match回调的子集，此为一个节点集合
    function  matchSelectors(array, match) {
        for (var i = 0, n = array.length; i < n; i++) {
            matchSelector(i, array, match)
        }
        return array.filter(function(el) {
            return el
        })
    }
    // 【matchSelectors】的辅助函数，判定array[i]及其祖先是否匹配match回调
    function matchSelector(i, array, match) {
        var elem = array[i]
        if (elem.node) {
            var node = elem.node
            var parent = elem.parent
        } else {
            node = elem
            parent = elem.parentNode
        }
        while (parent && parent.nodeType !== 9) {
            if (match(parent)) {
                return array[i] = {
                    node: node,
                    parent: parent.parentNode
                }
            }
            parent = parent.parentNode
        }
        array[i] = false
    }
    // 【avalon.state】的辅助函数，opts.template的处理函数
    function fromString(template, params) {
        var promise = new Promise(function(resolve, reject) {
            var str = typeof template === "function" ? template(params) : template
            if (typeof str == "string") {
                resolve(str)
            } else {
                reject("template必须对应一个字符串或一个返回字符串的函数")
            }
        })
        return promise
    }
    // 【fromUrl】的辅助函数，得到一个XMLHttpRequest对象
    var getXHR = function() {
        return new (window.XMLHttpRequest || ActiveXObject)("Microsoft.XMLHTTP")
    }
    // 【avalon.state】的辅助函数，opts.templateUrl的处理函数
    function fromUrl(url, params) {
        var promise = new Promise(function(resolve, reject) {
            if (typeof url === "function") {
                url = url(params)
            }
            if (typeof url !== "string") {
                return reject("templateUrl必须对应一个URL")
            }
            if (avalon.templateCache[url]) {
                return  resolve(avalon.templateCache[url])
            }
            var xhr = getXHR()
            xhr.onreadystatechange = function() {
                if (xhr.readyState === 4) {
                    var status = xhr.status;
                    if (status > 399 && status < 600) {
                        reject("templateUrl对应资源不存在或没有开启 CORS")
                    } else {
                        resolve(avalon.templateCache[url] = xhr.responseText)
                    }
                }
            }
            xhr.open("GET", url, true)
            if ("withCredentials" in xhr) {
                xhr.withCredentials = true
            }
            xhr.setRequestHeader("X-Requested-With", "XMLHttpRequest")
            xhr.send()
        })
        return promise
    }
    // 【avalon.state】的辅助函数，opts.templateProvider的处理函数
    function fromProvider(fn, params) {
        var promise = new Promise(function(resolve, reject) {
            if (typeof fn === "function") {
                var ret = fn(params)
                if (ret && ret.then) {
                    resolve(ret)
                } else {
                    reject("templateProvider为函数时应该返回一个Promise或thenable对象")
                }
            } else if (fn && fn.then) {
                resolve(fn)
            } else {
                reject("templateProvider不为函数时应该对应一个Promise或thenable对象")
            }
        })
        return promise
    }
    // 【avalon.state】的辅助函数，将template或templateUrl或templateProvider转换为可用的Promise对象
    function fromPromise(config, params) {
        return config.template ? fromString(config.template, params) :
                config.templateUrl ? fromUrl(config.templateUrl, params) :
                config.templateProvider ? fromProvider(config.templateProvider, params) :
                new Promise(function(resolve, reject) {
                    reject("必须存在template, templateUrl, templateProvider中的一个")
                })
    }
})