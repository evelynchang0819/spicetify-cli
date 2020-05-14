// @ts-check
// NAME: New Release
// AUTHOR: khanhas
// VERSION: 1.0
// DESCRIPTION: Gather new releases in nice UI and easy to access

/// <reference path="../globals.d.ts" />

(function NewRelease() {
    const { Player, CosmosAPI, LocalStorage, PlaybackControl, ContextMenu } = Spicetify
    if (!(Player && CosmosAPI && LocalStorage && PlaybackControl && ContextMenu)) {
        setTimeout(NewRelease, 300)
        return
    }

    // How far back the album/track was released to be considered "new"
    const DAYS_LIMIT = 30
    // UI Text
    const BUTTON_NAME_TEXT = "New Releases"
    const NO_FOLLOWED_ARTIST_TEXT = "You have not followed any artist."
    const NO_NEW_RELEASE_TEXT = `There is no new release in past ${DAYS_LIMIT} days`
    const IGNORE_TEXT = "Ignore"
    const UNIGNORE_TEXT = "Unignore"

    // Local Storage keys
    const LISTENED_URI_STORAGE_KEY = "spicetify_new_release:listened"
    const LISTENED_ALL_URI_STORAGE_KEY = "spicetify_new_release:listened_ALL"
    const FOLLOWEDONLY_SETTING_KEY = "spicetify_new_release:followed_only"
    const UNLISTENEDONLY_SETTING_KEY = "spicetify_new_release:unlistened_only"

    class ReleaseCollection {
        constructor() {
            this.list = {}
            const menu = createMenu()
            this.container = menu.container
            this.items = menu.menu
            this.lastScroll = 0
            this.container.onclick = () => {
                this.storeScroll()
                this.container.remove()
            }
        }

        apply(collection, unlistenedOnly) {
            this.list = {}
            this.items.textContent = '' // Remove all childs
            const stored = this.getStorage()
            for (const item of collection) {
                if (!item) continue

                const listened = stored.has(item.uri)
                this.list[item.uri] = listened

                if (listened && unlistenedOnly) continue

                const div = new CardContainer(item)
                div.setState(listened)
                this.items.append(div)
            }
            this.update()
        }

        update(unlistenedOnly) {
            /** @type {CardContainer[]}*/
            // @ts-ignore
            const array = Array.from(this.items.childNodes)
            array
                .sort((a, b) => (
                    (this.list[a.uri] - this.list[b.uri]) ||
                    (b.time - a.time)
                ))
                .forEach(child => {
                    const state = this.list[child.uri]
                    if (state && unlistenedOnly) {
                        this.items.removeChild(child)
                        return
                    }
                    child.setState(state)
                    this.items.append(child)
                })
        }

        // Is URI in collection and ready to change status
        isValid(uri) {
            return this.list.hasOwnProperty(uri)
        }

        isListened(uri) {
            return !!this.list[uri]
        }

        // Change URI listened status
        setListen(uri, state) {
            if (this.isValid(uri)) {
                this.list[uri] = state
            }
        }

        getLen() {
            return this.items.childElementCount
        }

        getUnlistenedLen() {
            return Object.values(this.list).filter(value => !value).length
        }

        getStorage() {
            let storage = new Set()

            try {
                JSON.parse(LocalStorage.get(LISTENED_URI_STORAGE_KEY))
                    .forEach(uri => storage.add(uri))
            } catch {
                LocalStorage.set(LISTENED_URI_STORAGE_KEY, "[]")
            }

            try {
                JSON.parse(LocalStorage.get(LISTENED_ALL_URI_STORAGE_KEY))
                    .forEach(uri => storage.add(uri))
            } catch {
                LocalStorage.set(LISTENED_ALL_URI_STORAGE_KEY, "[]")
            }

            return storage
        }

        setStorage(isFollowedOnly) {
            const simplified = Object.keys(this.list)
                .filter(key => this.list[key])
            LocalStorage.set(
                isFollowedOnly ?
                    LISTENED_URI_STORAGE_KEY :
                    LISTENED_ALL_URI_STORAGE_KEY,
                JSON.stringify(simplified)
            )
        }

        setMessage(msg) {
            this.items.innerHTML = `<div id="new-release-message">${msg}</div>`
        }

        changePosition(x, y) {
            this.items.style.left = x + "px"
            this.items.style.top = y + 10 + "px"
        }

        storeScroll() {
            this.lastScroll = this.items.scrollTop
        }

        setScroll() {
            this.items.scrollTop = this.lastScroll
        }
    }

    class TopBarButton {
        constructor() {
            this.container = createTopBarButton()
            this.span = createCounterSpan()
            this.container.append(this.span)

            // In case keys do not exist
            if (!LocalStorage.get(FOLLOWEDONLY_SETTING_KEY)) {
                this.setFollowedOnly(true)
            }
            if (!LocalStorage.get(UNLISTENEDONLY_SETTING_KEY)) {
                this.setUnlistenedOnly(false)
            }
        }

        update(count) {
            if (count > 0) {
                this.span.style.margin = "0 0 0 3px"
                this.span.innerText = count + ""
            } else {
                this.span.style.margin = ""
                this.span.innerText = ""
            }
        }

        loadingState() {
            this.container.classList.remove("spoticon-notifications-16")
            this.container.classList.add("spoticon-refresh-16")
        }

        idleState() {
            this.container.classList.remove("spoticon-refresh-16")
            this.container.classList.add("spoticon-notifications-16")
        }

        isFollowedOnly() {
            return LocalStorage.get(FOLLOWEDONLY_SETTING_KEY) === "1"
        }

        setFollowedOnly(state) {
            LocalStorage.set(FOLLOWEDONLY_SETTING_KEY, state ? "1" : "0")
        }

        isUnlistenedOnly() {
            return LocalStorage.get(UNLISTENEDONLY_SETTING_KEY) === "1"
        }

        setUnlistenedOnly(state) {
            LocalStorage.set(UNLISTENEDONLY_SETTING_KEY, state ? "1" : "0")
        }
    }

    const LIST = new ReleaseCollection()
    const BUTTON = new TopBarButton()
    const limitInMs = DAYS_LIMIT * 24 * 3600 * 1000
    let today

    document.querySelector("#view-browser-navigation-top-bar")
        .append(BUTTON.container)

    async function main() {
        today = new Date().getTime()

        BUTTON.update(0)
        BUTTON.loadingState()

        let artistList = await getArtistList()

        if (BUTTON.isFollowedOnly()) {
            artistList = artistList.filter(artist => artist.isFollowed)
            if (artistList.length === 0) {
                LIST.setMessage(NO_FOLLOWED_ARTIST_TEXT)
                BUTTON.idleState()
                return
            }
        }

        const requests = artistList
            .map(async (artist) => {
                const track = await getArtistNewRelease(artist.link.replace("spotify:artist:", ""))
                if (!track) return null
                const time = new Date(track.year, track.month - 1, track.day)
                if ((today - time.getTime()) < limitInMs) {
                    return ({
                        uri: track.uri,
                        name: track.name,
                        artist: artist.name,
                        cover: track.cover.uri,
                        time,
                    })
                }
            })

        const items = await Promise.all(requests)
        LIST.apply(items, BUTTON.isUnlistenedOnly())
        BUTTON.idleState()
        update()
    }

    function update() {
        LIST.setStorage(BUTTON.isFollowedOnly())
        LIST.update(BUTTON.isUnlistenedOnly())
        BUTTON.update(LIST.getUnlistenedLen())
        if (LIST.getLen() === 0) {
            LIST.setMessage(NO_NEW_RELEASE_TEXT)
        }
    }

    main()

    // Check whether currently playing track is in the new release. Set it "listened" if user is listening to it.
    Player.addEventListener("songchange", () => {
        if (LIST.getLen() === 0) return
        let uri = Player.data.context_uri
        if (!LIST.isValid(uri)) {
            uri = Player.data.track.metadata.album_uri
        }
        if (LIST.isListened(uri)) return

        LIST.setListen(uri, true)
        update()
    })

    // Add context menu items for Notification button
    const checkURI = ([uri]) => uri === "spotify:special:new-release"
    new ContextMenu.Item(
        "Followed artists only",
        function () {
            const state = !BUTTON.isFollowedOnly()
            BUTTON.setFollowedOnly(state)
            this.icon = state ? "check" : null
            main()
        },
        checkURI,
        BUTTON.isFollowedOnly() ? "check" : null,
    ).register()

    new ContextMenu.Item(
        "Unlistened releases only",
        function () {
            const state = !BUTTON.isUnlistenedOnly()
            BUTTON.setUnlistenedOnly(state)
            this.icon = state ? "check" : null
            main()
        },
        checkURI,
        BUTTON.isUnlistenedOnly() ? "check" : null,
    ).register()

    new ContextMenu.Item("Refresh", main, checkURI).register()

    function getArtistList() {
        return new Promise((resolve, reject) => {
            CosmosAPI.resolver.get("sp://core-collection/unstable/@/list/artists/all",
                (err, raw) => {
                    if (err) {
                        reject(err)
                        return
                    }
                    resolve(raw.getJSONBody().items)
                }
            )
        })
    }

    function getArtistNewRelease(uri) {
        return new Promise((resolve) => {
            CosmosAPI.resolver.get(
                `hm://artist/v3/${uri}/desktop/entity?format=json`,
                (err, raw) => {
                    if (err) {
                        resolve()
                        return
                    }
                    resolve(raw.getJSONBody().latest_release)
                }
            )
        })
    }

    function createTopBarButton() {
        const button = document.createElement("button")
        button.classList.add("button", "spoticon-notifications-16", "new-release-button")
        button.setAttribute("data-tooltip", BUTTON_NAME_TEXT)
        button.setAttribute("data-contextmenu", "")
        button.setAttribute("data-uri", "spotify:special:new-release")
        button.onclick = () => {
            const bound = button.getBoundingClientRect()
            LIST.changePosition(bound.left, bound.top)
            document.body.append(LIST.container)
            LIST.setScroll()
        }
        return button
    }

    function createCounterSpan() {
        const span = document.createElement("span")
        span.id = "new-release-counter"
        return span
    }

    function createMenu() {
        const container = document.createElement("div")
        container.id = "new-release-spicetify"
        container.className = "context-menu-container"
        container.style.zIndex = "1029"

        const style = document.createElement("style")
        style.textContent = `
#new-release-menu {
    display: inline-block;
    width: 33%;
    max-height: 70%;
    overflow: hidden auto;
    padding: 0 10px 10px
}
#new-release-message {
    margin-top: 10px
}
.new-release-controls {
    position: absolute;
    right: 0;
    bottom: 0;
    padding: 0 5px 5px 0;
    z-index: 3
}`

        const menu = document.createElement("ul")
        menu.id = "new-release-menu"
        menu.className = "context-menu"

        container.append(style)
        container.append(menu)

        return { container, menu }
    }

    class CardContainer extends HTMLElement {
        constructor(info) {
            super()
            this.uri = info.uri
            this.time = info.time.getTime()
            this.state = false

            this.innerHTML = `
<div class="card card-horizontal card-type-album" data-uri="${info.uri}" data-contextmenu="">
<div class="card-attention-highlight-box"></div>
<div class="card-horizontal-interior-wrapper">
    <div class="card-image-wrapper">
        <div class="card-image-hit-area">
            <a href="${info.uri}" class="card-image-link">
                <div class="card-hit-area-counter-scale-left"></div>
                <div class="card-image-content-wrapper">
                    <div class="card-image" style="background-image: url('${info.cover}')"></div>
                </div>
            </a>
            <div class="card-overlay"></div>
            <button class="button button-play button-icon-with-stroke card-button-play"></button>
        </div>
    </div>
    <div class="card-info-wrapper">
        <div class="new-release-controls hidden"></div>
        <a href="${info.uri}">
            <div class="card-hit-area-counter-scale-right"></div>
            <div class="card-info-content-wrapper">
                <div class="card-info-title"><span class="card-info-title-text">${info.name}</span></div>
                <div class="card-info-subtitle-description"><span>${info.artist}</span></div>
                <div class="card-info-subtitle-metadata">${info.time.toLocaleDateString()}</div>
            </div>
        </a>
    </div>
</div>
</div>`

            this.querySelector("button").onclick = (event) => {
                PlaybackControl.playFromResolver(this.uri, {}, () => { })
                event.stopPropagation()
            }

            /** @type {HTMLDivElement} */
            this.cover = this.querySelector(".card-image")

            /** @type {HTMLDivElement} */
            this.controls = this.querySelector(".new-release-controls")
            this.controls.onclick = (event) => {
                LIST.setListen(this.uri, !this.state)
                update()
                event.stopPropagation()
            }
            this.onmouseenter = () => this.controls.classList.remove("hidden")
            this.onmouseleave = () => this.controls.classList.add("hidden")
        }

        setState(state) {
            this.state = state
            if (state) {
                this.cover.style.filter = "grayscale(1)"
                this.controls.innerHTML = `<button class="button button-green spoticon-notifications-16" data-tooltip="${UNIGNORE_TEXT}"></button>`
            } else {
                this.cover.style.filter = ""
                this.controls.innerHTML = `<button class="button button-green">${IGNORE_TEXT}</button>`
            }
        }
    }

    customElements.define("card-container", CardContainer)
})()