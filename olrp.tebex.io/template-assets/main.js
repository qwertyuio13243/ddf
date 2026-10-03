/* SCSS sources, JavaScript and image assets are all available at https://github.com/BuycraftPlugin/webstore-templates */

/* global __, Tebex, __kTemplateConstants */

/**
 * @typedef {Object} TemplateConstants
 * @property {boolean} loginRequired
 * @property {boolean} isLoggedIn
 * @property {string} toast
 * @property {string} toastType
 * @property {string} checkoutTheme
 * @property {string} locale
 */

/**
 * @typedef {Object} BasketIdentResponse
 * @property {string} ident
 */

/**
 * @typedef {Object} HistoryState
 * @property {'page' | 'popup'} type
 * @property {string | URL} url
 * @property {?string} title
 */

/**
 * @typedef {Object} OpenURLPopupParams
 * @property {string} url URL to load the popup from
 * @property {string} className Class for the popup container
 * @property {string} contentClassName Class for the popup content element
 * @property {boolean} cache Whether to cache the popup
 * @property {boolean} pushHistory Whether to push a history state
 */

/**
 * @typedef {Object} AddToBasketResult
 * @property {boolean} status Whether the request was successful
 * @property {?string} message Info/Error message from the response page
 * @property {?DocumentFragment} optionsForm HTML for the options form
 */

/**
 * @typedef {Object} OpenOptionsPopupParams
 * @property {string} packageId The ID of the package to be displayed in the popup.
 * @property {string} type The type of the package to be displayed in the popup.
 * @property {HTMLElement} options The options form to be displayed in the popup.
 * @property {?string} giftTo Username to send the gift to.
 */

/**
 * @type {TemplateConstants}
 */
const kPresetConstants = __kTemplateConstants

const
    kOriginUrl = location.origin,
    kBasketUrl = kOriginUrl + '/checkout/basket',
    kBasketHashUrl = kOriginUrl + '/#basket',
    kLoginUrl = kOriginUrl + '/login',
    kInitialUrl = location.origin + location.pathname + location.search, // skip the hash
    kInitialTitle = document.title,
    kAddPackageAfterLoginLCKey = 'add-after-login',
    kGiftPackageAfterLoginLCKey = 'gift-after-login',
    kToastTimeout = 7000,
    kGiftInvalidUsername = 'Please enter a valid username.'

const
    handleBasketQuantityChangeDebounced = debounce(handleBasketQuantityChange, 1000),
    handlePackageQuantityChangeDebounced = debounce(handlePackageQuantityChange, 1000)

/**
 * @type {Promise<string | null> | null}
 */
let basketIdentPromise = null

function init() {
    if (location.origin + location.pathname === kBasketUrl) {
        location.href = kBasketHashUrl
        return
    }

    document.addEventListener('DOMContentLoaded', onDOMLoaded)
}

function onDOMLoaded() {
    setCountdowns()
    initCopyText()
    initNavigation()
    initTebexCheckout()
    setListeners()
    initPresetToast()
    maybeAddPackageAfterLogin()
    maybeGiftPackageAfterLogin()
    maybeOpenOptionsPopupAfterLogin()
    fixUserMenuWidth()
    window.addEventListener('popstate', handlePopState)

    if (location.origin + location.pathname + location.hash === kBasketHashUrl) {
        history.replaceState(null, null, kInitialUrl) // remove the #basket hash
        openBasket(true)
    }
}

function fixUserMenuWidth() {
    const
        userMenu = document.querySelector('.site-header .user-menu'),
        userMenuTrigger = document.querySelector('.site-header .user-name')

    if (!userMenu || !userMenuTrigger) {
        if (userMenu) {
            userMenu.style.minWidth = ''
        }

        return
    }

    userMenu.style.minWidth = `${userMenuTrigger.offsetWidth}px`

    userMenuTrigger.addEventListener('mouseenter', () => {
        userMenu.style.minWidth = `${userMenuTrigger.offsetWidth}px`
    })
}

async function maybeOpenOptionsPopupAfterLogin() {
    if (!location.pathname.startsWith('/checkout/packages/add/')) {
        return
    }

    const
        splitPath = location.pathname.split('/'),
        packageId = splitPath[4],
        type = splitPath[5],
        giftTo = new URL(location.href).searchParams.get('username')

    if (!packageId || !type) {
        return
    }

    const optionsCont = document.body
        .querySelector('[data-popup].store-product-options')

    if (!optionsCont) {
        return
    }

    const options = document.createDocumentFragment()
    options.append(...optionsCont.children)

    optionsCont.remove()

    const success = await openOptionsFormPopup({
        packageId,
        type,
        options,
        giftTo
    })

    if (success) {
        location.href = kBasketHashUrl
    } else {
        setTimeout(() => location.href = `/package/${packageId}`, 3000)
    }
}

async function maybeAddPackageAfterLogin() {
    const packageStr = localStorage.getItem(kAddPackageAfterLoginLCKey)

    if (!kPresetConstants.isLoggedIn || packageStr === null) {
        return
    }

    localStorage.removeItem(kAddPackageAfterLoginLCKey)

    const [packageId, type] = packageStr.split('/')

    if (!packageId || !type) {
        return
    }

    const result = await addToBasket(packageId, type)

    if (result.message) {
        newToast(result.message, result.status ? 'info' : 'error')
    }

    if (result.optionsForm) {
        openOptionsFormPopup({
            packageId,
            type,
            options: result.optionsForm
        })
    } else if (result.status) {
        await onPackageStateChanged(packageId, 1)
    } else {
        location.href = `${kOriginUrl}/package/${packageId}`
    }
}

async function maybeGiftPackageAfterLogin() {
    const packageStr = localStorage.getItem(kGiftPackageAfterLoginLCKey)

    if (!kPresetConstants.isLoggedIn || packageStr === null) {
        return
    }

    localStorage.removeItem(kGiftPackageAfterLoginLCKey)

    const [packageId, type] = packageStr.split('/')

    if (packageId && type) {
        openGiftFormPopup(packageId, type)
    }
}

/**
 * Check if the current page can be opened as a popup
 * @param {string | URL} url
 */
function isPopupUrl(url) {
    try {
        url = (typeof url === 'string') ? new URL(url) : url
        return (isLoginUrl(url) || isBasketUrl(url) || isProductUrl(url))
    } catch (e) {
        return false
    }
}

/**
 * Check if the current page can be opened as a login popup
 * @param {URL} url
 */
function isLoginUrl(url) {
    try {
        url = (typeof url === 'string') ? new URL(url) : url
        return (url.origin === location.origin && url.pathname === '/login')
    } catch (e) {
        return false
    }
}

/**
 * Check if the current page can be opened as a basket popup
 * @param {URL} url
 */
function isBasketUrl(url) {
    try {
        url = (typeof url === 'string') ? new URL(url) : url
        return (url.origin === location.origin && url.pathname === '/checkout/basket')
    } catch (e) {
        return false
    }
}

/**
 * Check if the current page can be opened as a package popup
 * @param {URL} url
 */
function isProductUrl(url) {
    try {
        url = (typeof url === 'string') ? new URL(url) : url
        return (url.origin === location.origin && /\/package\/\d+/gi.test(url.pathname))
    } catch (e) {
        return false
    }
}

function setListeners() {
    setPopupListeners()
    setPackageActionsListeners()
    setBasketOpenListeners()
    setCountdowns()
}

/**
 * Set up a countdown
 * @param {HTMLElement} el
 */
function setCountdown(el) {
    const secondsToEnd = parseInt(el.dataset.countdown)

    const endsOn = Math.floor(Date.now() / 1000) + secondsToEnd

    updateCountdown(el, endsOn)
    setInterval(() => updateCountdown(el, endsOn), 1000)
}

/**
 * Updates the countdown display for a given element until it reaches zero.
 *
 * @param {HTMLElement} el - The element to update the countdown for.
 * @param {number} endsOn - The UNIX timestamp representing the end time of the countdown.
 *
 * The function calculates the remaining time from the current time to the specified end time,
 * and updates the text content of the element to show the countdown in the format of
 * "Xd HH:MM:SS" where X is the number of days, HH is hours, MM is minutes, and SS is seconds.
 * If the countdown reaches zero, it displays "Time Expired" and stops the interval.
 */
function updateCountdown(el, endsOn) {
    const secondsLeft = endsOn - Math.floor(Date.now() / 1000)

    if (secondsLeft <= 0) {
        el.textContent = __("Time Expired")
        clearInterval(interval)
        return
    }

    const
        days = Math.floor(secondsLeft / (60 * 60 * 24)),
        hours = Math.floor((secondsLeft % (60 * 60 * 24)) / (60 * 60)),
        minutes = Math.floor((secondsLeft % (60 * 60)) / (60)),
        seconds = Math.floor((secondsLeft % 60))

    let textString = `${padNumber(hours)}:${padNumber(minutes)}:${padNumber(seconds)}`

    if (days > 0) {
        textString = `${days}d ${textString}`
    }

    el.textContent = textString
}

function setCountdowns() {
    const countdowns = document.querySelectorAll('[data-countdown]')

    for (let el of countdowns) {
        if (!el.dataset.countdownSet) {
            el.dataset.countdownSet = true
            setCountdown(el)
        }
    }
}

function initCopyText() {
    const elements = document.querySelectorAll('[data-copy]')

    for (let el of elements) {
        el.addEventListener('click', () => copyText(el))
    }
}

/**
 * Copy text to clipboard
 * @param {HTMLElement} el - Element to copy from
 */
function copyText(el) {
    const content = el.innerHTML

    copyToClipboard(el.dataset.copy)

    el.innerHTML = __('Copied!')

    setTimeout(() => el.innerHTML = content, 3000)
}

/**
 * Toggles open menu item
 * @param {HTMLElement} button - Toggle button
 */
function toggleMenuItem(button) {
    const
        menuItem = button.parentNode,
        otherMenuItems = [...menuItem.parentNode.children]
        .filter(item => item !== menuItem)

    const className = 'expanded'

    if (menuItem.classList.contains(className)) {
        menuItem.classList.remove(className)
        return
    }

    menuItem.classList.add(className)

    for (const otherMenuItem of otherMenuItems) {
        otherMenuItem.classList.remove(className)
    }
}

function openNavigation() {
    document.body.classList.add('show-navigation')
}

function closeNavigation() {
    document.body.classList.remove('show-navigation')
}

function initNavigation() {
    const
        navigationCont = document.querySelector('.site-navigation'),
        toggleNavButton = document.querySelector('.toggle-navigation')

    if (!navigationCont || !toggleNavButton) {
        return
    }

    const
        closeNavButton = navigationCont.querySelector('.close-navigation'),
        toggleButtons = navigationCont.querySelectorAll('.toggle')

    toggleNavButton.addEventListener('click', () => {
        if (document.body.classList.contains('show-navigation')) {
            closeNavigation()
        } else {
            openNavigation()
        }
    })

    closeNavButton.addEventListener('click', closeNavigation)

    navigationCont.addEventListener('click', event => {
        if (event.target === navigationCont) {
            closeNavigation()
        }
    })

    for (const button of toggleButtons) {
        button.addEventListener('click', () => {
            toggleMenuItem(button)
        })
    }
}

function setPopupListeners() {
    /**
     * @type {HTMLAnchorElement[]}
     */
    const links = document.querySelectorAll('a')

    for (const link of links) {
        if (
            link.dataset.clickSet ||
            !isPopupUrl(link.href) ||
            link.dataset.noPopup
        ) {
            continue
        }

        link.dataset.clickSet = true

        link.addEventListener('click', e => {
            e.preventDefault()

            const url = new URL(link.href)

            if (isBasketUrl(url)) {
                openBasket()
            } else if (isLoginUrl(url)) {
                openLoginPopup()
            } else if (isProductUrl(url)) {
                openProductPopup(link.href)
            }
        })
    }
}

function setBasketOpenListeners() {
    const buttons = document.querySelectorAll('button.open-basket')

    for (const button of buttons) {
        if (!button.dataset.clickSet) {
            button.dataset.clickSet = true
            button.addEventListener('click', openBasket)
        }
    }
}

/**
 * @param {HTMLElement} actions
 * @param {string | number} packageId
 */
async function handleAddToBasketClick(actions, packageId) {
    const type = actions.dataset.packageType

    if (kPresetConstants.loginRequired && !kPresetConstants.isLoggedIn) {
        localStorage.setItem(kAddPackageAfterLoginLCKey, `${packageId}/${type}`)
        openLoginPopup()
        return
    }

    actions.classList.add('updating')

    const result = await addToBasket(packageId, type)

    actions.classList.remove('updating')

    if (result.message) {
        newToast(result.message, result.status ? 'info' : 'error')
    }

    const parentPopup = actions.closest('.popup')

    if (result.optionsForm) {
        if (parentPopup) {
            closePopup(parentPopup, true)
        }

        openOptionsFormPopup({
            packageId,
            type,
            options: result.optionsForm
        })
    } else if (result.status) {
        if (parentPopup) {
            closePopup(parentPopup, true)
        }

        await onPackageStateChanged(packageId, 1)
    } else if (!result.message) {
        newToast(__('Failed to add to basket'), 'error')
    }
}

/**
 * Update the state of package .product-actions elements
 * @param {HTMLElement} actions
 * @param {number} quantity
 */
function updatePackageActionsState(actions, quantity = 0) {
    const
        addLink = actions.querySelector('.add'),
        quantityField = actions.querySelector('.quantity-field'),
        quantityFieldInput = quantityField ? .querySelector('input.quantity'),
        openBasketCTA = actions.querySelector('.open-basket-cta'),
        isZero = quantity === 0

    addLink.hidden = !isZero

    if (quantityField) {
        quantityField.hidden = isZero

        if (quantityFieldInput) {
            quantityFieldInput.value = quantity
        }
    }

    if (openBasketCTA) {
        openBasketCTA.hidden = isZero
    }
}

/**
 * @param {MouseEvent} e
 */
function handleIncreaseQuantity(e) {
    e.preventDefault()

    const
        quantityEl = e.target.parentNode.querySelector('input.quantity'),
        max = (quantityEl.max) ? parseInt(quantityEl.max, 10) : Infinity

    let value = parseInt(quantityEl.value, 10)

    value = Math.min(value + 1, max)

    quantityEl.value = value
}

/**
 * @param {MouseEvent} e
 */
function handleDecreaseQuantity(e) {
    e.preventDefault()

    const
        quantityEl = e.target.parentNode.querySelector('input.quantity'),
        min = (quantityEl.min) ? parseInt(quantityEl.min, 10) : 0

    let value = parseInt(quantityEl.value, 10)

    value = Math.max(value - 1, min)

    quantityEl.value = value
}

/**
 * Handles store item quantity change events
 * @param {HTMLElement} actions - .product-actions container
 */
async function handlePackageQuantityChange(actions) {
    const
        packageId = actions.dataset.package,
        quantityInput = actions.querySelector('input.quantity'),
        min = (quantityInput.min) ? parseInt(quantityInput.min, 10) : 0,
        max = (quantityInput.max) ? parseInt(quantityInput.max, 10) : Infinity

    let value = parseInt(quantityInput.value, 10)

    const clampedValue = Math.max(Math.min(value, max), min)

    if (clampedValue !== value) {
        quantityInput.value = clampedValue
        value = clampedValue
    }

    actions.classList.add('updating')

    updatePackageActionsState(actions, value)

    const otherPackages = document
        .querySelectorAll(`.product-actions[data-package="${packageId}"]`)

    for (const instance of otherPackages) {
        if (instance !== actions) {
            updatePackageActionsState(instance, value)
        }
    }

    if (value <= 0) {
        await removeFromBasket(packageId)
    } else {
        await updateBasketQuantities({
            [quantityInput.name]: value
        })
    }

    if (isBasketOpen()) {
        await updateBasketContent()
    }

    actions.classList.remove('updating')
}

/**
 * Handles basket item quantity change events
 * @param {HTMLElement} container - .basket-item
 */
async function handleBasketQuantityChange(container) {
    const
        basketItems = container.querySelectorAll('.basket-item'),
        quantities = {}

    for (const basketItem of basketItems) {
        const
            packageId = basketItem.dataset.package,
            quantityInput = basketItem.querySelector('input.quantity'),
            value = parseInt(quantityInput.value, 10)

        quantities[quantityInput.name] = value

        const storePackages = document
            .querySelectorAll(`.product-actions[data-package="${packageId}"]`)

        for (const instance of storePackages) {
            updatePackageActionsState(instance, value)
        }
    }

    container.classList.add('updating')

    await updateBasketQuantities(quantities)

    if (isBasketOpen()) {
        await updateBasketContent()
    }

    container.classList.remove('updating')
}

/**
 * Updates the package actions state and opens the basket after a package has been added.
 * @param {string | number} packageId - The ID of the added package.
 * @param {number} count - The updated package count.
 * @return {Promise<void>}
 */
async function onPackageStateChanged(packageId, count) {
    const instances = document.querySelectorAll(
        `.product-actions[data-package="${packageId}"]`
    )

    for (const instance of instances) {
        instance.classList.remove('updating')
        updatePackageActionsState(instance, count)
    }

    if (count > 0) {
        await openBasket()
    } else if (isBasketOpen()) {
        await updateBasketContent()
    }
}

/**
 * Opens a popup with options, returns the form data or null if the user cancels.
 * @param {OpenOptionsPopupParams} params
 * @returns {Promise<boolean>}
 */
function openOptionsFormPopup({
    packageId,
    type,
    options,
    giftTo
}) {
    return new Promise(resolve => {
        const container = document.createElement('div')
        container.classList.value = 'popup product-options-popup'

        const scrollContainer = document.createElement('div')
        scrollContainer.classList.value = 'popup-scroll-cont'
        scrollContainer.addEventListener('mousedown', e => {
            if (e.target === scrollContainer) {
                closePopup(container, false, true)
                resolve(false)
            }
        })

        container.appendChild(scrollContainer)

        const closeButton = document.createElement('button')
        closeButton.textContent = __('Close')
        closeButton.classList.value = 'popup-close'
        closeButton.addEventListener('click', () => {
            closePopup(container, false, true)
            resolve(false)
        })

        const contentEl = document.createElement('div')
        contentEl.classList.value = 'popup-content store-product-options'
        contentEl.appendChild(closeButton)

        scrollContainer.appendChild(contentEl)

        document.documentElement.classList.add('no-scroll')
        document.body.appendChild(container)

        contentEl.appendChild(options)

        const form = contentEl.querySelector('form')

        if (!form) {
            closePopup(container, false, true)
            return resolve(false)
        }

        form.addEventListener('submit', async e => {
            e.preventDefault()

            const isValid = form.reportValidity()

            if (!isValid) {
                newToast(__('Please fill in all fields'), 'error')
                return
            }

            const actions = form.querySelector('.actions')

            actions ? .classList.add('updating')

            const options = [...new FormData(form).entries()]
                .reduce((obj, [key, value]) => {
                    obj[key] = value
                    return obj
                }, {})

            const result = await addToBasketWithOptions(
                packageId,
                type,
                options,
                giftTo
            )

            actions ? .classList.remove('updating')

            if (result.message) {
                newToast(result.message, result.status ? 'info' : 'error')
            }

            if (result.status) {
                closePopup(container, false, true)
                await onPackageStateChanged(packageId, 1)
            } else if (!result.message) {
                newToast(__('Failed to add to basket'), 'error')
                await new Promise(r => setTimeout(r, 3000)) // wait to show toast
            }

            resolve(result.status)
        })
    })
}

/**
 * Open gift form
 * @param {number} packageId
 * @param {string} type
 */
function openGiftFormPopup(packageId, type) {
    if (kPresetConstants.loginRequired && !kPresetConstants.isLoggedIn) {
        localStorage.setItem(kGiftPackageAfterLoginLCKey, `${packageId}/${type}`)
        openLoginPopup()
        return
    }

    const container = document.createElement('div')
    container.classList.add('popup', 'gift-form-popup')

    const scrollContainer = document.createElement('div')
    scrollContainer.classList.value = 'popup-scroll-cont'
    scrollContainer.addEventListener('mousedown', e => {
        if (e.target === scrollContainer) {
            closePopup(container, false, true)
        }
    })

    container.appendChild(scrollContainer)

    const content = document.createElement('form')
    content.classList.add('popup-content', 'text-content', 'store-form')
    content.innerHTML = `<h2>${__('Gift this package')}</h2>
<input
  type="text"
  name="username"
  placeholder="${__('Enter a username to gift this package to')}"
  required
  class="form-control"
/>
<div class="actions">
  <button class="btn-primary" type="submit">${__('Send gift')}</button>
</div>`
    scrollContainer.appendChild(content)

    const closeButton = document.createElement('button')
    closeButton.classList.value = 'popup-close'
    closeButton.textContent = __('Close')
    closeButton.addEventListener('click', () => {
        closePopup(container, false, true)
    })

    content.appendChild(closeButton)

    content.addEventListener('submit', async e => {
        e.preventDefault()

        const
            input = content.querySelector('input[name=username]'),
            actions = content.querySelector('.actions')

        if (!input) {
            return
        }

        const username = input.value.trim()

        if (!username) {
            newToast(__('Please enter a username'), 'error')
            return
        }

        actions ? .classList.add('updating')

        const result = await addToBasket(packageId, type, username)

        actions ? .classList.remove('updating')

        if (result.message) {
            newToast(result.message, result.status ? 'info' : 'error')
        }

        if (result.optionsForm) {
            closePopup(container, false, true)
            openOptionsFormPopup({
                packageId,
                type,
                options: result.optionsForm,
                giftTo: username
            })
        } else if (result.status) {
            closePopup(container, false, true)
            await onPackageStateChanged(packageId, 1)
        } else if (!result.message) {
            newToast(__('Failed to add to basket'), 'error')
        }
    })

    document.body.appendChild(container)

    content.querySelector('input').focus()

    return container
}

/**
 * @param {string} url
 * @param {boolean} pushHistory
 */
async function openProductPopup(url, pushHistory = true) {
    const popup = await openUrlPopup({
        url,
        className: 'store-product-popup',
        contentClassName: 'store-product-popup-content store-product store-product-full',
        pushHistory
    })

    if (popup) {
        setListeners()
    }
}

async function openBasket(pushHistory = true) {
    if (isBasketOpen()) {
        await updateBasketContent()
        return
    }

    basketIdentPromise = getBasketIdent()

    const popup = await openUrlPopup({
        url: kBasketUrl,
        className: 'basket-popup',
        contentClassName: 'basket-popup-content basket',
        cache: false,
        pushHistory
    })

    if (popup) {
        setBasketEventListeners(popup.querySelector('.popup-content'))
    }
}

async function openLoginPopup(pushHistory = true) {
    await openUrlPopup({
        url: kLoginUrl,
        className: 'login-popup',
        contentClassName: 'login-popup-content store-form text-content',
        pushHistory
    })
}

/**
 * @param {PopStateEvent} e
 */
function handlePopState(e) {
    /**
     * @type {HistoryState}
     */
    const state = e.state

    closeNavigation()

    if (state ? .type !== 'popup') {
        document.querySelectorAll('.popup').forEach(el => el.hidden = true)
        document.documentElement.classList.remove('no-scroll')
    }

    if (!state || state.type === 'page') {
        document.title = state ? .title ? ? kInitialTitle
    } else if (state.type === 'popup') {
        const url = (typeof state.url === 'string') ?
            new URL(state.url) :
            state.url

        if (isBasketUrl(url)) {
            openBasket(false)
        } else if (isLoginUrl(url)) {
            openLoginPopup(false)
        } else if (isProductUrl(url)) {
            openProductPopup(url.href, false)
        }
    }
}

/**
 * Pushes a history state
 * @param {HistoryState} state
 */
function pushHistoryState(state) {
    history.pushState(state, null, state.url)

    if (state.title) {
        document.title = state.title
    }
}

/**
 * Gets an element by selector from HTML
 * @param {string} html
 * @param {string} selector
 * @returns { ?{ title: string; content: DocumentFragment } } - Returns null if not found
 */
function getBySelectorFromHTML(html, selector) {
    const tempEl = document.createElement('template')

    tempEl.innerHTML = html

    const result = tempEl.content.querySelector(selector)

    if (!result) {
        return null
    }

    const title = tempEl.content.querySelector('title') ? .textContent ? ? ''

    const documentFragment = document.createDocumentFragment()

    documentFragment.append(...result.children)

    return {
        title,
        content: documentFragment
    }
}

function makeEmptyBasketContent() {
    const empty = document.createElement('div')
    empty.classList.value = 'basket-empty'
    empty.textContent = __('Basket is empty')

    return empty
}

/**
 * Opens a popup
 * @param {OpenURLPopupParams}
 * @returns {Promise<HTMLElement | null>} - Returns null if popup could not be loaded
 */
async function openUrlPopup({
    url,
    className,
    contentClassName,
    cache = true,
    pushHistory = true
}) {
    // console.log('openUrlPopup():', { url, className, cache, pushHistory })

    if (!isPopupUrl(url)) {
        console.warn('openUrlPopup(): url not supported:', url)
        return null
    }

    const existingContainer = document.querySelector(`.popup[data-url="${url}"]`)

    if (existingContainer) {
        if (cache) {
            if (pushHistory) {
                pushHistoryState({
                    type: 'popup',
                    url,
                    title: existingContainer.dataset.title
                })
            }

            document.documentElement.classList.add('no-scroll')
            existingContainer.hidden = false
            return existingContainer
        } else {
            existingContainer.remove()
        }
    }

    let cancelled = false

    const container = document.createElement('div')
    container.dataset.url = url
    container.classList.add('popup', 'popup-loading', ...className.split(' '))

    const handleKeydown = e => {
        if (e.key === 'Escape') {
            cancelled = true
            closePopup(container, true, !cache)

            if (!cache) {
                document.removeEventListener('keydown', handleKeydown)
            }
        }
    }

    document.addEventListener('keydown', handleKeydown)

    const scrollContainer = document.createElement('div')
    scrollContainer.classList.value = 'popup-scroll-cont'
    scrollContainer.addEventListener('mousedown', e => {
        if (e.target === scrollContainer) {
            cancelled = true
            closePopup(container, true, !cache)
        }
    })

    container.appendChild(scrollContainer)

    const closeButton = document.createElement('button')
    closeButton.textContent = __('Close')
    closeButton.classList.value = 'popup-close'
    closeButton.addEventListener('click', () => {
        cancelled = true
        closePopup(container, true, !cache)
    })

    const contentEl = document.createElement('div')
    contentEl.classList.add('popup-content', ...contentClassName.split(' '))
    contentEl.appendChild(closeButton)

    scrollContainer.appendChild(contentEl)

    document.documentElement.classList.add('no-scroll')
    document.body.appendChild(container)

    const response = await fetch(url)

    if (cancelled) {
        return null
    }

    if (!response.ok) {
        console.warn(
            'openUrlPopup(): could not find contents:',
            response.status,
            response.statusText
        )
        return null
    }

    const html = await response.text()

    if (cancelled) {
        return null
    }

    let results = getBySelectorFromHTML(html, '[data-popup]')

    if (!results) {
        if (url === kBasketUrl) {
            results = {
                title: kInitialTitle,
                content: makeEmptyBasketContent()
            }
        } else {
            console.warn('openUrlPopup(): could not find popup contents')
            return null
        }
    }

    if (pushHistory) {
        pushHistoryState({
            type: 'popup',
            url,
            title: results.title
        })
    }

    container.classList.remove('popup-loading')
    container.dataset.title = results.title
    contentEl.appendChild(results.content)

    return container
}

/**
 * Closes the popup pushes a history state
 * @param {HTMLElement} popupContainer
 * @param {boolean} pushHistory
 * @param {boolean} remove
 */
function closePopup(popupContainer, pushHistory = true, remove = true) {
    document.documentElement.classList.remove('no-scroll')

    if (popupContainer.hidden) {
        return
    }

    if (remove) {
        const
            bodyStyles = window.getComputedStyle(popupContainer),
            fadeDurationCSS = bodyStyles.getPropertyValue('--fade-duration') ? ? '0.3s', // in seconds, string
            fadeDuration = parseFloat(fadeDurationCSS) * 1000 // ms

        setTimeout(() => {
            if (popupContainer.hidden) {
                popupContainer.remove()
            }
        }, fadeDuration + 20)
    }

    popupContainer.hidden = true

    if (pushHistory) {
        pushHistoryState({
            type: 'page',
            url: kInitialUrl,
            title: kInitialTitle
        })
    }
}

/**
 * Copies text to clipboard
 * @param {string} text
 */
function copyToClipboard(text) {
    if (navigator.clipboard) {
        navigator.clipboard.writeText(text)
    }
}

async function initTebexCheckout() {
    if (!window.Tebex) {
        await new Promise(resolve => window.addEventListener('load', resolve))
    }

    Tebex.checkout.on(Tebex.events.PAYMENT_COMPLETE, () => {
        location.href = kOriginUrl
    })
}

function setPackageActionsListeners() {
    const products = document.querySelectorAll('.product-actions[data-package]')

    for (const product of products) {
        setPackageActionsListener(product)
    }
}

/**
 * @param {HTMLElement} actions - .product-actions element
 */
function setPackageActionsListener(actions) {
    const
        packageId = actions.dataset.package,
        addLink = actions.querySelector('.add'),
        giftLink = actions.querySelector('.gift'),
        quantityField = actions.querySelector('.quantity-field'),
        decreaseButton = quantityField ? .querySelector('button.decrease'),
        increaseButton = quantityField ? .querySelector('button.increase'),
        quantityInput = quantityField ? .querySelector('input.quantity')

    if (addLink && !addLink.dataset.clickSet) {
        addLink.dataset.clickSet = true
        addLink.addEventListener('click', e => {
            e.preventDefault()
            handleAddToBasketClick(actions, packageId)
        })
    }

    if (decreaseButton && !decreaseButton.dataset.clickSet) {
        decreaseButton.dataset.clickSet = true
        decreaseButton.addEventListener('click', e => {
            handleDecreaseQuantity(e)
            handlePackageQuantityChangeDebounced(actions)
        })
    }

    if (increaseButton && !increaseButton.dataset.clickSet) {
        increaseButton.dataset.clickSet = true
        increaseButton.addEventListener('click', e => {
            handleIncreaseQuantity(e)
            handlePackageQuantityChangeDebounced(actions)
        })
    }

    if (quantityInput && !quantityInput.dataset.changeSet) {
        quantityInput.dataset.changeSet = true
        quantityInput.addEventListener('input', () => {
            handlePackageQuantityChangeDebounced(actions)
        })
    }

    if (giftLink && !giftLink.dataset.clickSet) {
        giftLink.dataset.clickSet = true
        giftLink.addEventListener('click', e => {
            e.preventDefault()
            openGiftFormPopup(packageId, actions.dataset.packageType)
        })
    }
}

/**
 * Add a package to basket. Returns document fragment with options form if they
 * are required
 * @param {number|string} packageId
 * @param {string} type
 * @param {?string} giftTo - username of the gift recipient
 * @returns {Promise<AddToBasketResult>}
 */
async function addToBasket(packageId, type = 'single', giftTo) {
    const typeAction = sanitizePurchaseType(type)

    let url = `/checkout/packages/add/${packageId}/${typeAction}`

    if (giftTo) {
        url += `/gift?username=${giftTo}`
    }

    const response = await fetch(url)

    const text = await response.text()

    const t = document.createElement('template')
    t.innerHTML = text

    const site = t.content.querySelector('.site')

    if (!site && !response.ok) {
        return {
            status: false,
            message: text
        }
    }

    const
        toast = site ? .dataset ? .toast,
        isError = (toast === kGiftInvalidUsername || toast === __(kGiftInvalidUsername))

    const options = t.content.querySelector('[data-popup].store-product-options')

    if (!options) {
        return {
            status: !isError,
            message: toast
        }
    }

    const documentFragment = document.createDocumentFragment()
    documentFragment.append(...options.children)

    return {
        status: true,
        optionsForm: documentFragment,
        message: toast
    }
}

/**
 * Add a package to basket with options/variables
 * @param {number|string} packageId
 * @param {string} type
 * @param {Record<string, string} options
 * @param {?string} giftTo - username of the gift recipient
 * @returns {Promise<AddToBasketResult>}
 */
async function addToBasketWithOptions(
    packageId,
    type = 'single',
    options,
    giftTo
) {
    const params = new URLSearchParams(options)

    params.append('username', giftTo)
    params.append('submit', '1')

    const typeAction = sanitizePurchaseType(type)

    let url = `/checkout/packages/add/${packageId}/${typeAction}`

    if (giftTo) {
        url += `/gift?username=${giftTo}`
    }

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: params
    })

    const text = await response.text()

    const t = document.createElement('template')
    t.innerHTML = text

    const site = t.content.querySelector('.site')

    if (!site && !response.ok) {
        return {
            status: false,
            message: text
        }
    }

    const
        toast = site ? .dataset ? .toast,
        isError = (toast === kGiftInvalidUsername || toast === __(kGiftInvalidUsername))

    return {
        status: !isError,
        message: toast
    }
}

/**
 * @param {Record<string, number>} basketData
 */
async function updateBasketQuantities(basketData) {
    const formData = new URLSearchParams(basketData)

    const response = await fetch('/checkout/update', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: formData
    })

    // console.log('updateBasketData():', formData, response)

    return response.ok
}

/**
 * @param {number | string} packageId
 */
async function removeFromBasket(packageId) {
    const response = await fetch(`/checkout/packages/remove/${packageId}`)

    // console.log('removeFromBasket():', response)

    return response.ok
}

function isBasketOpen() {
    return document.querySelector('.basket-popup-content') !== null
}

async function updateBasketContent(basketUrl = kBasketUrl) {
    const basketContainer = document.querySelector('.basket-popup')

    if (!basketContainer) {
        console.warn('updateBasketContent(): could not find basket container')
        return false
    }

    const basketEl = basketContainer.querySelector('.basket-popup-content')

    if (!basketEl) {
        console.warn('updateBasketContent(): could not find basket container')
        return false
    }

    const response = await fetch(basketUrl)

    if (!response.ok) {
        console.warn(
            'updateBasketContent(): could not find contents:',
            response.status,
            response.statusText
        )
        return false
    }

    const html = await response.text()

    const parseResults = getBySelectorFromHTML(html, 'form.basket')

    if (!parseResults) {
        console.warn('updateBasketContent(): could not get basket element, closing basket')
        closePopup(basketContainer, true, true)
        return false
    }

    const {
        content
    } = parseResults

    const selectorsToReplace = [
        '.basket-header',
        '.basket-second-header',
        '.basket-content',
        '.basket-checkout .total',
        '.basket-redeem .redeemed'
    ]

    for (const selector of selectorsToReplace) {
        const
            oldEl = basketEl.querySelector(selector),
            newEl = content.querySelector(selector)

        if (oldEl && newEl) {
            oldEl.replaceWith(newEl)
        }
    }

    setBasketEventListeners(basketEl)

    return true
}

/**
 * Adds event listeners to basket elements
 * @param {HTMLElement} basketEl - Basket .popup-content container
 */
function setBasketEventListeners(basketEl) {
    const
        decreaseButtons = basketEl.querySelectorAll('button.decrease'),
        increaseButtons = basketEl.querySelectorAll('button.increase'),
        quantityInputs = basketEl.querySelectorAll('input.quantity'),
        removeButtons = basketEl.querySelectorAll('a.remove'),
        checkoutButton = basketEl.querySelector('button.checkout')

    for (const button of decreaseButtons) {
        if (!button.dataset.clickSet) {
            button.dataset.clickSet = true
            button.addEventListener('click', e => {
                handleDecreaseQuantity(e)
                handleBasketQuantityChangeDebounced(basketEl)
            })
        }
    }

    for (const button of increaseButtons) {
        if (!button.dataset.clickSet) {
            button.dataset.clickSet = true
            button.addEventListener('click', e => {
                handleIncreaseQuantity(e)
                handleBasketQuantityChangeDebounced(basketEl)
            })
        }
    }

    for (const input of quantityInputs) {
        if (!input.dataset.changeSet) {
            input.dataset.changeSet = true
            input.addEventListener('input', () => {
                handleBasketQuantityChangeDebounced(basketEl)
            })
        }
    }

    for (const button of removeButtons) {
        if (!button.dataset.clickSet) {
            button.dataset.clickSet = true
            button.addEventListener('click', async e => {
                const packageId = e.target.closest('.basket-item') ? .dataset.package

                if (packageId) {
                    e.preventDefault()
                    basketEl.classList.add('updating')
                    await removeFromBasket(packageId)
                    await onPackageStateChanged(packageId, 0)
                    basketEl.classList.remove('updating')
                }
            })
        }
    }

    if (checkoutButton && !checkoutButton.dataset.clickSet) {
        checkoutButton.dataset.clickSet = true
        checkoutButton.addEventListener('click', e => {
            e.preventDefault()

            checkoutButton.disabled = true

            openCheckout().finally(() => {
                checkoutButton.disabled = false
            })
        })
    }

    if (checkoutButton && basketIdentPromise) {
        checkoutButton.disabled = true

        basketIdentPromise.then(() => {
            checkoutButton.disabled = false
        })
    }
}

/**
 * Fetches the basket ident string or null if not found
 */
async function getBasketIdent() {
    const response = await fetch('/checkout/ident')

    if (!response.ok) {
        console.warn(
            'getBasketIdent(): couldn\'t get basket ident:',
            response.status,
            response.statusText
        )
        return null
    }

    try {
        /**
         * @type {BasketIdentResponse}
         */
        const parsed = await response.json()

        if (!parsed || !parsed.ident) {
            console.warn('getBasketIdent(): no ident in response')
            return null
        }

        return parsed.ident
    } catch (e) {
        console.warn('getBasketIdent(): couldn\'t parse ident response:', e)
        return null
    }
}

/**
 * Open checkout
 */
async function openCheckout() {
    if (!basketIdentPromise) {
        console.warn('openCheckout(): basket ident promise not set')
        return
    }

    const basketIdent = await basketIdentPromise

    if (!basketIdent) {
        console.warn('openCheckout(): could not get basket ident')
        return
    }

    const
        bodyStyles = window.getComputedStyle(document.body),
        primaryColor = bodyStyles.getPropertyValue('--color-primary'),
        secondaryColor = bodyStyles.getPropertyValue('--color-secondary')

    const config = {
        ident: basketIdent,
        theme: kPresetConstants.checkoutTheme,
        locale: kPresetConstants.locale,
        colors: [{
                name: 'primary',
                color: primaryColor
            },
            {
                name: 'secondary',
                color: secondaryColor
            }
        ]
    }

    Tebex.checkout.init(config)
    Tebex.checkout.launch()
    Tebex.checkout.on(Tebex.events.PAYMENT_COMPLETE, event => {
        console.log("Payment completed!", event);
        basketIdentPromise = null
    });

}

function padNumber(n) {
    return n.toString().padStart(2, '0')
}

/**
 * Debounces a function
 * @param {Function} func
 * @param {number} timeout
 */
function debounce(func, timeout) {
    let timeoutId
    return (...args) => {
        clearTimeout(timeoutId)
        timeoutId = setTimeout(() => {
            func(...args)
        }, timeout)
    }
}

/**
 * Create new toast
 * @param {string} content - Toast content
 * @param {'info'|'success'|'warning'|'error'} type
 */
function newToast(content, type = 'info') {
    const toast = document.createElement('div')
    toast.classList.value = `toast toast-${type}`
    toast.role = 'alert'

    let closeTimeout = setTimeout(() => closeToast(toast), kToastTimeout)

    toast.addEventListener('mouseenter', () => {
        clearTimeout(closeTimeout)
    })

    toast.addEventListener('mouseleave', () => {
        clearTimeout(closeTimeout)
        closeTimeout = setTimeout(() => closeToast(toast), kToastTimeout)
    })

    const toastContent = document.createElement('p')
    toastContent.textContent = content
    toast.appendChild(toastContent)

    const closeButton = document.createElement('button')
    closeButton.classList.value = 'toast-close'
    closeButton.textContent = __('Close')
    closeButton.addEventListener('click', () => {
        clearTimeout(closeTimeout)
        closeToast(toast)
    })
    toast.appendChild(closeButton)

    let toaster = document.querySelector('.toaster')

    if (!toaster) {
        toaster = document.createElement('div')
        toaster.classList.value = 'toaster'
        document.body.appendChild(toaster)
    }

    toaster.appendChild(toast)

    return toast
}

/**
 * Close toast
 * @param {HTMLElement} toast
 */
function closeToast(toast) {
    toast.addEventListener('transitionend', e => {
        if (toast.hidden && e.propertyName === 'opacity') {
            toast.remove()
        }
    })

    toast.hidden = true
}

function initPresetToast() {
    if (kPresetConstants.toast) {
        newToast(kPresetConstants.toast)
    }
}

/**
 * Sanitizes the purchase type to ensure consistency.
 *
 * @param {string} type - The type of purchase to sanitize.
 * @returns {'subscribe' | 'single'} - The sanitized purchase type.
 */
function sanitizePurchaseType(type) {
    if (type === 'subscribe' || type === 'subscription') {
        return 'subscribe'
    }

    return 'single'
}

init()