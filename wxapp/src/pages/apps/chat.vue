<template>
  <view class="page">
    <view :style="{ height: statusBarH + 'px' }" />

    <view class="header">
      <view class="icon-btn" @click="goBack">
        <u-icon name="arrow-left" size="20" color="#111827" />
      </view>
      <view class="header-main">
        <text class="eyebrow">MOBILE AI</text>
        <text class="title">{{ activeMode === 'image' ? '图片大模型' : 'AI 大模型对话' }}</text>
      </view>
      <view class="header-actions">
        <view class="text-btn" @click="historyOpen = true">
          <text>记录</text>
        </view>
        <view class="icon-btn" @click="clearChat">
          <u-icon name="reload" size="18" color="#111827" />
        </view>
      </view>
    </view>

    <view class="mode-tabs">
      <view
        v-for="mode in modes"
        :key="mode.value"
        class="mode-tab"
        :class="{ active: activeMode === mode.value }"
        @click="switchMode(mode.value)"
      >
        <text>{{ mode.label }}</text>
      </view>
    </view>

    <view class="model-bar">
      <view class="model-info" @click="pickerOpen = !pickerOpen">
        <text class="model-label">当前模型</text>
        <text class="model-name">{{ selectedModelNameText }}</text>
      </view>
      <view class="model-switch" @click="pickerOpen = !pickerOpen">
        <u-icon name="arrow-down" size="16" color="#4b5563" />
      </view>
    </view>

    <text class="retention-tip">对话记录和图片仅保存一周，请及时保存重要内容。</text>

    <view v-if="pickerOpen" class="model-panel">
      <view v-if="modelsLoading" class="panel-state">
        <u-loading-icon size="26" color="#4f6ef7" />
        <text>模型加载中</text>
      </view>
      <view v-else-if="activeModels.length === 0" class="panel-state">
        <text>{{ modelEmptyText }}</text>
      </view>
      <scroll-view v-else scroll-y class="model-scroll">
        <view
          v-for="model in activeModels"
          :key="model.name"
          class="model-item"
          :class="{ active: model.name === selectedModelName }"
          @click="selectModel(model)"
        >
          <view class="model-item-main">
            <text class="model-item-name">{{ model.displayName }}</text>
            <text class="model-item-desc">{{ model.vendor || 'AI Model' }}</text>
          </view>
          <u-icon v-if="model.name === selectedModelName" name="checkmark" size="16" color="#4f6ef7" />
        </view>
      </scroll-view>
    </view>

    <scroll-view
      scroll-y
      class="messages"
      :scroll-into-view="scrollAnchor"
      scroll-with-animation
    >
      <view v-if="messages.length === 0" class="welcome">
        <view class="welcome-icon">
          <text>{{ activeMode === 'image' ? 'IMG' : 'AI' }}</text>
        </view>
        <text class="welcome-title">{{ activeMode === 'image' ? '生成一张图片' : '开始一次对话' }}</text>
        <text class="welcome-desc">{{ welcomeDesc }}</text>
        <view class="quick-list">
          <view
            v-for="item in quickPrompts"
            :key="item"
            class="quick-item"
            @click="input = item"
          >
            <text>{{ item }}</text>
          </view>
        </view>
      </view>

      <view v-for="message in messages" :key="message.id" class="msg-row" :class="message.role">
        <view class="msg-bubble">
          <text class="msg-role">{{ message.role === 'user' ? '我' : activeMode === 'image' ? '图片' : 'AI' }}</text>
          <text v-if="message.content" class="msg-content">{{ message.content }}</text>
          <view v-if="hasMessageImages(message)" class="image-grid">
            <image
              v-for="src in message.images"
              :key="src"
              class="result-image"
              :src="toDisplayImageUrl(src)"
              mode="aspectFill"
              show-menu-by-longpress
              @click="previewImage(src, message.images)"
            />
            <text v-if="message.kind === 'image' && message.role === 'assistant'" class="image-save-tip">
              长按图片可保存到相册，图片记录仅保存一周。
            </text>
          </view>
        </view>
      </view>

      <view v-if="running" class="msg-row assistant">
        <view class="msg-bubble loading-bubble">
          <u-loading-icon size="24" color="#6b7280" />
          <text class="loading-text">{{ runningText }}</text>
        </view>
      </view>
      <view id="bottom-anchor" style="height: 1rpx;" />
    </scroll-view>

    <view class="composer">
      <view v-if="activeMode === 'image'" class="reference-panel">
        <view class="reference-head">
          <view class="reference-btn" :class="{ disabled: running || referenceImages.length >= MAX_REFERENCE_IMAGES }" @click="chooseReferenceImages">
            <u-icon name="plus" size="15" color="#111827" />
            <text>参考图 {{ referenceImages.length }}/{{ MAX_REFERENCE_IMAGES }}</text>
          </view>
          <view v-if="referenceImages.length" class="reference-clear" :class="{ disabled: running }" @click="clearReferenceImages">
            <text>清空</text>
          </view>
        </view>
        <scroll-view v-if="referenceImages.length" scroll-x class="reference-scroll">
          <view class="reference-list">
            <view v-for="image in referenceImages" :key="image.id" class="reference-item">
              <image class="reference-img" :src="image.path" mode="aspectFill" />
              <view class="reference-remove" @click="removeReferenceImage(image.id)">
                <u-icon name="close" size="12" color="#111827" />
              </view>
            </view>
          </view>
        </scroll-view>
      </view>
      <view class="input-row">
        <textarea
          v-model="input"
          class="input"
          :disabled="running"
          :maxlength="4000"
          auto-height
          confirm-type="send"
          :placeholder="activeMode === 'image' ? '描述你想生成的图片...' : '问问模型：帮我写一段小程序介绍...'"
          placeholder-class="input-placeholder"
        />
        <view class="send-btn" :class="{ disabled: !canSend }" @click="send">
          <u-loading-icon v-if="running" size="28" color="#fff" />
          <u-icon v-else name="arrow-upward" size="18" color="#fff" />
        </view>
      </view>
    </view>

    <view v-if="historyOpen" class="history-mask" @click="historyOpen = false">
      <view class="history-panel" @click.stop>
        <view class="history-head">
          <view>
            <text class="history-title">本地记录</text>
            <text class="history-subtitle">记录仅保存一周</text>
          </view>
          <view class="history-close" @click="historyOpen = false">
            <u-icon name="close" size="18" color="#111827" />
          </view>
        </view>
        <scroll-view scroll-y class="history-list">
          <view v-if="historyItems.length === 0" class="history-empty">
            <text>暂无记录</text>
          </view>
          <view
            v-for="item in historyItems"
            :key="item.id"
            class="history-item"
            @click="jumpToHistory(item)"
          >
            <view class="history-type">
              <text>{{ item.kind === 'image' ? '图片' : item.role === 'user' ? '我' : 'AI' }}</text>
            </view>
            <view class="history-main">
              <text class="history-content">{{ item.content || '图片结果' }}</text>
              <text class="history-time">{{ formatTime(item.createdAt) }}</text>
            </view>
          </view>
        </scroll-view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { computed, nextTick, ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import {
  createMobileChatCompletion,
  createMobileImageGeneration,
  getMobileImageTask,
  getPricingModels,
  getSelf,
  uploadAppImages,
} from '@/services/api.js'
import env from '@/config/env.js'
import { userStore } from '@/store/user.js'

const statusBarH = ref(0)
const chatModels = ref([])
const imageModels = ref([])
const modelsLoading = ref(false)
const selectedModelNames = ref({ chat: '', image: '' })
const activeMode = ref('chat')
const pickerOpen = ref(false)
const input = ref('')
const messages = ref([])
const running = ref(false)
const historyOpen = ref(false)
const scrollAnchor = ref('')
const referenceImages = ref([])

const MAX_REFERENCE_IMAGES = 16

const modes = [
  { value: 'chat', label: '文字对话' },
  { value: 'image', label: '图片生成' },
]

const chatPrompts = [
  '帮我总结一下今天要做的三件事',
  '写一段适合小程序首页的产品介绍',
  '用通俗语言解释一下大模型 API 怎么使用',
]

const imagePrompts = [
  '一张干净的科技产品海报，浅色背景，中心是智能助手界面',
  '小程序首页插画，温暖明亮，包含 AI 聊天和图片生成元素',
  '一张适合头像的未来感机器人，简洁高级，正方形构图',
]

const activeModels = computed(() => (activeMode.value === 'image' ? imageModels.value : chatModels.value))
const selectedModelName = computed(() => selectedModelNames.value[activeMode.value] || '')
const selectedModel = computed(() => {
  return activeModels.value.find((model) => model.name === selectedModelName.value) || activeModels.value[0] || null
})
const quickPrompts = computed(() => (activeMode.value === 'image' ? imagePrompts : chatPrompts))
const modelEmptyText = computed(() => (activeMode.value === 'image' ? '暂无可用图片模型' : '暂无可用大语言模型'))
const selectedModelNameText = computed(() => (selectedModel.value && selectedModel.value.displayName) || modelEmptyText.value)
const welcomeDesc = computed(() => (
  activeMode.value === 'image'
    ? '选择图片模型后输入提示词，生成结果会保存在本机记录里。'
    : '选择模型后输入问题，消耗会计入你的平台余额。'
))
const runningText = computed(() => (activeMode.value === 'image' ? '图片生成中' : '思考中'))
const canSend = computed(() => Boolean(input.value.trim()) && Boolean(selectedModel.value) && !running.value)
const historyItems = computed(() => [...messages.value].reverse())

function isImageModel(row) {
  const endpoints = row && Array.isArray(row.supported_endpoint_types) ? row.supported_endpoint_types : []
  const name = String((row && row.model_name) || '').toLowerCase()
  const text = `${name} ${(row && row.description) || ''} ${(row && row.tags) || ''}`.toLowerCase()
  if (endpoints.includes('image-generation')) return true
  return [
    'gpt-image',
    'dall-e',
    'imagen',
    'flux',
    'stable-diffusion',
    'midjourney',
    'seedream',
    'kling',
    'kolors',
    'recraft',
    'ideogram',
    'wanx',
    'cogview',
    'dreamina',
    'nano-banana',
    'image-preview',
  ].some((keyword) => text.includes(keyword))
}

function displayName(name) {
  const value = String(name || '')
  if (value.toLowerCase() === 'gemini-3-pro-image-preview') return 'Nano Banana Pro'
  return value
}

function normalizeModel(row, kind) {
  return {
    name: row.model_name,
    displayName: displayName(row.model_name),
    vendor: row.owner_by || (kind === 'image' ? 'Image Model' : 'AI Model'),
    kind,
  }
}

function normalizeModels(data) {
  const rows = Array.isArray(data) ? data : data && Array.isArray(data.data) ? data.data : []
  const nextChat = []
  const nextImage = []
  rows.forEach((row) => {
    if (!row || !row.model_name) return
    if (isImageModel(row)) {
      nextImage.push(normalizeModel(row, 'image'))
    } else {
      nextChat.push(normalizeModel(row, 'chat'))
    }
  })
  return { chat: nextChat, image: nextImage }
}

function historyKey() {
  const userId = (userStore.userInfo && userStore.userInfo.id) || 'guest'
  return `wxapp_mobile_chat:${userId}`
}

function loadLocalHistory() {
  try {
    const stored = uni.getStorageSync(historyKey())
    const items = stored ? JSON.parse(stored) : []
    messages.value = Array.isArray(items) ? items.slice(-60) : []
  } catch {
    messages.value = []
  }
}

function persistLocalHistory() {
  uni.setStorageSync(historyKey(), JSON.stringify(messages.value.slice(-60)))
}

function pickDefaultModel(models, preferred) {
  const preferredModel = models.find((model) => model.name === preferred)
  if (preferredModel) return preferredModel.name
  return models.length > 0 ? models[0].name : ''
}

async function loadModels() {
  modelsLoading.value = true
  try {
    const rows = normalizeModels(await getPricingModels())
    chatModels.value = rows.chat.length ? rows.chat : [{ name: 'gpt-4.1-mini', displayName: 'gpt-4.1-mini', vendor: 'OpenAI', kind: 'chat' }]
    imageModels.value = rows.image
    if (!chatModels.value.some((model) => model.name === selectedModelNames.value.chat)) {
      selectedModelNames.value.chat = pickDefaultModel(chatModels.value, 'gpt-5.5')
    }
    if (!imageModels.value.some((model) => model.name === selectedModelNames.value.image)) {
      selectedModelNames.value.image = pickDefaultModel(imageModels.value, 'gemini-3-pro-image-preview')
    }
  } catch {
    chatModels.value = [{ name: 'gpt-4.1-mini', displayName: 'gpt-4.1-mini', vendor: 'OpenAI', kind: 'chat' }]
    imageModels.value = []
    selectedModelNames.value.chat = chatModels.value[0].name
    selectedModelNames.value.image = ''
  } finally {
    modelsLoading.value = false
  }
}

function switchMode(mode) {
  if (running.value || activeMode.value === mode) return
  activeMode.value = mode
  pickerOpen.value = false
  if (mode !== 'image') clearReferenceImages()
}

function selectModel(model) {
  selectedModelNames.value[activeMode.value] = model.name
  pickerOpen.value = false
}

function hasMessageImages(message) {
  return Boolean(message && Array.isArray(message.images) && message.images.length > 0)
}

function createMessage(role, content, extra = {}) {
  return {
    id: `${role}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    role,
    content,
    kind: activeMode.value,
    createdAt: Date.now(),
    ...extra,
  }
}

function extractReply(data) {
  if (typeof data === 'string') return data
  if (!data || typeof data !== 'object') return '模型已返回结果，但当前页面无法解析为文本。'
  if (typeof data.output_text === 'string') return data.output_text
  const choices = data.choices
  if (Array.isArray(choices) && choices.length > 0) {
    const first = choices[0] || {}
    const content = first.message && first.message.content != null ? first.message.content : first.text
    if (typeof content === 'string') return content
    if (Array.isArray(content)) {
      return content.map((item) => (item && (item.text || item.content)) || '').filter(Boolean).join('\n')
    }
  }
  return '模型已返回结果，但当前页面无法解析为文本。'
}

function extractImageItems(data) {
  if (Array.isArray(data)) return data
  if (!data || typeof data !== 'object') return []
  if (Array.isArray(data.data)) return data.data
  if (data.result) return extractImageItems(data.result)
  return []
}

function extractImageUrls(data) {
  return extractImageItems(data)
    .map((item) => {
      if (typeof item === 'string') return item
      if (!item || typeof item !== 'object') return ''
      if (typeof item.url === 'string') return item.url
      if (typeof item.b64_json === 'string' && item.b64_json) return `data:image/png;base64,${item.b64_json}`
      return ''
    })
    .filter(Boolean)
}

function imageContentType(path) {
  const value = String(path || '').toLowerCase()
  if (value.endsWith('.png')) return 'image/png'
  if (value.endsWith('.webp')) return 'image/webp'
  if (value.endsWith('.gif')) return 'image/gif'
  return 'image/jpeg'
}

function readLocalFile(path) {
  return new Promise((resolve, reject) => {
    const fs = typeof uni.getFileSystemManager === 'function' ? uni.getFileSystemManager() : null
    if (!fs || !path) {
      reject(new Error('当前环境不支持读取本地图片'))
      return
    }
    fs.readFile({
      filePath: path,
      success: (res) => resolve(res.data),
      fail: () => reject(new Error('读取参考图失败')),
    })
  })
}

async function uploadReferenceImages(images) {
  const pending = images.filter((image) => !image.objectUrl)
  if (pending.length) {
    const uploaded = await uploadAppImages(
      await Promise.all(
        pending.map(async (image, index) => {
          const data = await readLocalFile(image.path)
          const contentType = image.contentType || imageContentType(image.path)
          return {
            filename: image.name || `reference-${index + 1}.jpg`,
            contentType,
            data,
          }
        })
      )
    )
    const items = uploaded.items || []
    if (items.length !== pending.length) throw new Error('参考图上传结果数量不匹配')
    pending.forEach((image, index) => {
      image.objectUrl = (items[index] && items[index].object_url) || ''
    })
  }
  return images.map((image) => image.objectUrl).filter(Boolean)
}

function chooseReferenceImages() {
  if (running.value || activeMode.value !== 'image') return
  const available = MAX_REFERENCE_IMAGES - referenceImages.value.length
  if (available <= 0) {
    uni.showToast({ title: `最多上传 ${MAX_REFERENCE_IMAGES} 张参考图`, icon: 'none' })
    return
  }
  uni.chooseImage({
    count: available,
    sizeType: ['compressed', 'original'],
    sourceType: ['album', 'camera'],
    success(res) {
      const paths = Array.isArray(res.tempFilePaths) ? res.tempFilePaths : []
      const files = Array.isArray(res.tempFiles) ? res.tempFiles : []
      const next = paths.map((path, index) => {
        const file = files[index] || {}
        return {
          id: `ref-${Date.now()}-${index}-${Math.random().toString(16).slice(2)}`,
          path,
          name: `reference-${Date.now()}-${index}.jpg`,
          size: file.size || 1,
          contentType: imageContentType(path),
        }
      })
      referenceImages.value = [...referenceImages.value, ...next].slice(0, MAX_REFERENCE_IMAGES)
    },
  })
}

function removeReferenceImage(id) {
  if (running.value) return
  referenceImages.value = referenceImages.value.filter((image) => image.id !== id)
}

function clearReferenceImages() {
  if (running.value) return
  referenceImages.value = []
}

function parseTaskId(data) {
  const payload = data && data.data
  const first = Array.isArray(payload) ? payload[0] : null
  const taskId = (data && data.task_id) || (payload && payload.task_id) || (first && first.task_id)
  if (!taskId) throw new Error('图片任务提交成功，但没有返回 task_id')
  return taskId
}

function normalizeTaskStatus(status) {
  const value = String(status || '').toLowerCase()
  if (['succeeded', 'success', 'completed', 'complete'].includes(value)) return 'succeeded'
  if (['failed', 'failure', 'error'].includes(value)) return 'failed'
  if (['processing', 'running', 'in_progress'].includes(value)) return 'running'
  return 'queued'
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitImageResult(taskId) {
  const startedAt = Date.now()
  const timeoutMs = 18 * 60 * 1000
  let delayMs = 2500

  while (Date.now() - startedAt < timeoutMs) {
    await sleep(delayMs)
    const data = await getMobileImageTask(taskId)
    const status = normalizeTaskStatus(data && data.status)
    if (status === 'succeeded') {
      if (!data || !data.result) throw new Error('图片任务已完成，但结果为空')
      return data.result
    }
    if (status === 'failed') {
      throw new Error((data && data.error && data.error.message) || '图片生成失败')
    }
    delayMs = Math.min(6000, Math.round(delayMs * 1.15))
  }

  throw new Error('图片生成等待超时，请稍后从记录查看')
}

function toDisplayImageUrl(src) {
  const value = String(src || '').trim()
  if (!value || /^https?:\/\//i.test(value) || value.startsWith('data:')) return value
  const base = env.basePath.replace(/\/$/, '')
  return value.startsWith('/') ? `${base}${value}` : `${base}/${value}`
}

function previewImage(src, images) {
  const urls = images.map(toDisplayImageUrl)
  uni.previewImage({
    urls,
    current: toDisplayImageUrl(src),
  })
}

function formatTime(ts) {
  if (!ts) return ''
  const date = new Date(ts)
  const pad = (num) => String(num).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function jumpToHistory() {
  historyOpen.value = false
  scrollToBottom()
}

function scrollToBottom() {
  scrollAnchor.value = ''
  nextTick(() => {
    scrollAnchor.value = 'bottom-anchor'
  })
}

function goBack() {
  uni.navigateBack({ delta: 1, fail: () => uni.reLaunch({ url: '/pages/apps/index' }) })
}

function clearChat() {
  if (running.value) return
  uni.showModal({
    title: '新对话',
    content: '清空当前小程序本地对话和图片记录？',
    confirmText: '清空',
    success(res) {
      if (!res.confirm) return
      messages.value = []
      persistLocalHistory()
    },
  })
}

async function ensureLogin() {
  if (!userStore.isLoggedIn || !userStore.token) {
    uni.navigateTo({ url: '/pages/login/index' })
    return false
  }
  try {
    const data = await getSelf()
    if (!data || !data.id) throw new Error('invalid session')
    userStore.setUserInfo(data)
    return true
  } catch {
    uni.showToast({ title: '登录已失效，请重新登录', icon: 'none' })
    setTimeout(() => uni.navigateTo({ url: '/pages/login/index' }), 600)
    return false
  }
}

async function sendChat(content, activeModel) {
  const userMessage = createMessage('user', content)
  const contextMessages = [...messages.value, userMessage]
    .filter((message) => message.kind !== 'image')
    .slice(-8)
    .map((message) => ({
      role: message.role,
      content: message.content,
    }))

  messages.value = [...messages.value, userMessage]
  input.value = ''
  running.value = true
  persistLocalHistory()
  scrollToBottom()

  try {
    const data = await createMobileChatCompletion({
      model: activeModel.name,
      group: (userStore.userInfo && userStore.userInfo.group) || undefined,
      messages: contextMessages,
    })
    messages.value = [...messages.value, createMessage('assistant', extractReply(data), { kind: 'chat' })]
  } catch (err) {
    messages.value = [...messages.value, createMessage('assistant', `请求失败：${(err && err.message) || '对话请求失败'}`, { kind: 'chat' })]
  } finally {
    running.value = false
    persistLocalHistory()
    scrollToBottom()
  }
}

async function sendImage(content, activeModel) {
  const refs = referenceImages.value.slice(0, MAX_REFERENCE_IMAGES)
  const userMessage = createMessage('user', refs.length ? `${content}\n\n参考图：${refs.length} 张` : content, {
    kind: 'image',
    images: refs.map((image) => image.path),
  })
  messages.value = [...messages.value, userMessage]
  input.value = ''
  referenceImages.value = []
  running.value = true
  persistLocalHistory()
  scrollToBottom()

  try {
    const imageUrls = refs.length ? await uploadReferenceImages(refs) : []
    const submitted = await createMobileImageGeneration({
      model: activeModel.name,
      prompt: content,
      images: imageUrls,
    })
    const result = await waitImageResult(parseTaskId(submitted))
    const images = extractImageUrls(result)
    if (images.length === 0) throw new Error('图片已生成，但没有拿到可展示的图片地址')
    messages.value = [
      ...messages.value,
      createMessage('assistant', '图片已生成', {
        kind: 'image',
        images,
      }),
    ]
  } catch (err) {
    messages.value = [...messages.value, createMessage('assistant', `图片生成失败：${(err && err.message) || '请稍后重试'}`, { kind: 'image' })]
  } finally {
    running.value = false
    persistLocalHistory()
    scrollToBottom()
  }
}

async function send() {
  const content = input.value.trim()
  if (!content || running.value || !selectedModel.value) return
  if (!(await ensureLogin())) return

  const activeModel = selectedModel.value
  if (activeMode.value === 'image') {
    await sendImage(content, activeModel)
  } else {
    await sendChat(content, activeModel)
  }
}

onLoad((options = {}) => {
  statusBarH.value = uni.getSystemInfoSync().statusBarHeight || 0
  if (options.mode === 'image') activeMode.value = 'image'
  if (options.draft) input.value = decodeURIComponent(String(options.draft))
  loadLocalHistory()
  loadModels()
})

onShow(() => {
  if (userStore.isLoggedIn) {
    getSelf().then((data) => data && userStore.setUserInfo(data)).catch(() => {})
  }
})
</script>

<style lang="scss" scoped>
.page {
  min-height: 100vh;
  background: #f7f3ea;
  display: flex;
  flex-direction: column;
}

.header {
  height: 96rpx;
  padding: 0 24rpx;
  display: flex;
  align-items: center;
  gap: 18rpx;
  background: rgba(247, 243, 234, 0.96);
  border-bottom: 1rpx solid rgba(17, 24, 39, 0.08);
}

.icon-btn {
  width: 68rpx;
  height: 68rpx;
  border-radius: 20rpx;
  background: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 8rpx 24rpx rgba(20, 16, 8, 0.05);
}

.header-main {
  flex: 1;
  min-width: 0;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 12rpx;
}

.text-btn {
  height: 68rpx;
  padding: 0 22rpx;
  border-radius: 20rpx;
  background: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #111827;
  font-size: 24rpx;
  font-weight: 800;
  box-shadow: 0 8rpx 24rpx rgba(20, 16, 8, 0.05);
}

.eyebrow {
  display: block;
  font-size: 18rpx;
  color: #b8780c;
  font-weight: 800;
}

.title {
  display: block;
  margin-top: 2rpx;
  font-size: 32rpx;
  color: #111827;
  font-weight: 850;
}

.mode-tabs {
  margin: 20rpx 24rpx 0;
  padding: 8rpx;
  border-radius: 22rpx;
  background: #fff;
  display: flex;
  gap: 8rpx;
  box-shadow: 0 8rpx 24rpx rgba(20, 16, 8, 0.05);
}

.mode-tab {
  flex: 1;
  height: 64rpx;
  border-radius: 16rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #6b7280;
  font-size: 24rpx;
  font-weight: 800;
}

.mode-tab.active {
  background: #111827;
  color: #fff;
}

.model-bar {
  margin: 16rpx 24rpx 0;
  min-height: 88rpx;
  border-radius: 22rpx;
  padding: 16rpx 18rpx;
  background: #fff;
  display: flex;
  align-items: center;
  gap: 18rpx;
  box-shadow: 0 8rpx 24rpx rgba(20, 16, 8, 0.05);
}

.model-info {
  flex: 1;
  min-width: 0;
}

.model-label {
  display: block;
  font-size: 20rpx;
  color: #9ca3af;
}

.model-name {
  display: block;
  margin-top: 4rpx;
  font-size: 26rpx;
  color: #111827;
  font-weight: 800;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-switch {
  width: 56rpx;
  height: 56rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.model-panel {
  margin: 12rpx 24rpx 0;
  border-radius: 22rpx;
  background: #fff;
  padding: 12rpx;
  box-shadow: 0 8rpx 24rpx rgba(20, 16, 8, 0.06);
}

.retention-tip {
  display: block;
  margin: 14rpx 28rpx 0;
  color: #9ca3af;
  font-size: 21rpx;
  line-height: 1.45;
}

.model-scroll {
  max-height: 420rpx;
}

.panel-state {
  min-height: 132rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12rpx;
  color: #6b7280;
  font-size: 24rpx;
}

.model-item {
  min-height: 82rpx;
  border-radius: 16rpx;
  padding: 12rpx 16rpx;
  display: flex;
  align-items: center;
  gap: 14rpx;
}

.model-item.active {
  background: #eef2ff;
}

.model-item-main {
  flex: 1;
  min-width: 0;
}

.model-item-name {
  display: block;
  font-size: 24rpx;
  color: #111827;
  font-weight: 750;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-item-desc {
  display: block;
  margin-top: 4rpx;
  font-size: 20rpx;
  color: #9ca3af;
}

.messages {
  flex: 1;
  min-height: 0;
  padding: 24rpx;
  box-sizing: border-box;
}

.welcome {
  margin-top: 54rpx;
  padding: 48rpx 32rpx;
  border-radius: 28rpx;
  background: #fff;
  box-shadow: 0 8rpx 24rpx rgba(20, 16, 8, 0.05);
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}

.welcome-icon {
  width: 92rpx;
  height: 92rpx;
  border-radius: 28rpx;
  background: #eef2ff;
  display: flex;
  align-items: center;
  justify-content: center;
}

.welcome-icon text {
  color: #4f6ef7;
  font-size: 28rpx;
  font-weight: 950;
}

.welcome-title {
  margin-top: 22rpx;
  font-size: 32rpx;
  color: #111827;
  font-weight: 850;
}

.welcome-desc {
  margin-top: 10rpx;
  font-size: 24rpx;
  line-height: 1.55;
  color: #6b7280;
}

.quick-list {
  width: 100%;
  margin-top: 28rpx;
  display: flex;
  flex-direction: column;
  gap: 12rpx;
}

.quick-item {
  min-height: 64rpx;
  border-radius: 16rpx;
  padding: 14rpx 18rpx;
  background: #f8fafc;
  color: #374151;
  font-size: 24rpx;
  text-align: left;
}

.msg-row {
  display: flex;
  margin-bottom: 20rpx;
}

.msg-row.user {
  justify-content: flex-end;
}

.msg-row.assistant {
  justify-content: flex-start;
}

.msg-bubble {
  max-width: 86%;
  border-radius: 24rpx;
  padding: 18rpx 22rpx;
  background: #fff;
  box-shadow: 0 6rpx 18rpx rgba(20, 16, 8, 0.05);
}

.msg-row.user .msg-bubble {
  background: #4f6ef7;
}

.msg-role {
  display: block;
  margin-bottom: 8rpx;
  font-size: 20rpx;
  color: #9ca3af;
  font-weight: 750;
}

.msg-row.user .msg-role {
  color: rgba(255, 255, 255, 0.72);
}

.msg-content {
  display: block;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 27rpx;
  line-height: 1.65;
  color: #111827;
}

.msg-row.user .msg-content {
  color: #fff;
}

.image-grid {
  margin-top: 14rpx;
  display: flex;
  flex-direction: column;
  gap: 12rpx;
}

.result-image {
  width: 420rpx;
  height: 420rpx;
  max-width: 100%;
  border-radius: 20rpx;
  background: #f3f4f6;
}

.image-save-tip {
  color: #9ca3af;
  font-size: 21rpx;
  line-height: 1.5;
}

.loading-bubble {
  display: flex;
  align-items: center;
  gap: 12rpx;
}

.loading-text {
  font-size: 24rpx;
  color: #6b7280;
}

.composer {
  padding: 16rpx 24rpx calc(24rpx + env(safe-area-inset-bottom));
  background: rgba(247, 243, 234, 0.96);
  border-top: 1rpx solid rgba(17, 24, 39, 0.08);
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 14rpx;
}

.input-row {
  width: 100%;
  display: flex;
  align-items: flex-end;
  gap: 14rpx;
}

.reference-panel {
  width: 100%;
  border-radius: 22rpx;
  background: rgba(255, 255, 255, 0.78);
  padding: 12rpx;
  box-sizing: border-box;
}

.reference-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12rpx;
}

.reference-btn,
.reference-clear {
  height: 56rpx;
  border-radius: 16rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22rpx;
  font-weight: 800;
}

.reference-btn {
  padding: 0 18rpx;
  gap: 8rpx;
  background: #ffb84a;
  color: #111827;
}

.reference-clear {
  padding: 0 16rpx;
  color: #6b7280;
}

.reference-btn.disabled,
.reference-clear.disabled {
  opacity: 0.45;
}

.reference-scroll {
  width: 100%;
  margin-top: 12rpx;
  white-space: nowrap;
}

.reference-list {
  display: flex;
  gap: 12rpx;
}

.reference-item {
  position: relative;
  width: 112rpx;
  height: 112rpx;
  flex-shrink: 0;
}

.reference-img {
  width: 112rpx;
  height: 112rpx;
  border-radius: 18rpx;
  background: #f3f4f6;
}

.reference-remove {
  position: absolute;
  top: -8rpx;
  right: -8rpx;
  width: 34rpx;
  height: 34rpx;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.94);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4rpx 12rpx rgba(17, 24, 39, 0.14);
}

.input {
  flex: 1;
  min-width: 0;
  min-height: 78rpx;
  max-height: 220rpx;
  border-radius: 22rpx;
  background: #fff;
  padding: 20rpx 22rpx;
  box-sizing: border-box;
  font-size: 27rpx;
  line-height: 1.45;
  color: #111827;
  box-shadow: 0 8rpx 24rpx rgba(20, 16, 8, 0.05);
}

.input-placeholder {
  color: #9ca3af;
}

.send-btn {
  width: 78rpx;
  height: 78rpx;
  border-radius: 24rpx;
  background: #4f6ef7;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 8rpx 22rpx rgba(79, 110, 247, 0.28);
}

.send-btn.disabled {
  opacity: 0.45;
}

.history-mask {
  position: fixed;
  inset: 0;
  z-index: 20;
  background: rgba(17, 24, 39, 0.42);
  display: flex;
  align-items: flex-end;
}

.history-panel {
  width: 100%;
  max-height: 70vh;
  padding: 24rpx;
  padding-bottom: calc(24rpx + env(safe-area-inset-bottom));
  border-radius: 30rpx 30rpx 0 0;
  background: #fff;
  box-sizing: border-box;
}

.history-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 18rpx;
}

.history-title {
  display: block;
  color: #111827;
  font-size: 30rpx;
  font-weight: 850;
}

.history-subtitle {
  display: block;
  margin-top: 4rpx;
  color: #9ca3af;
  font-size: 21rpx;
}

.history-close {
  width: 56rpx;
  height: 56rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.history-list {
  max-height: 56vh;
}

.history-empty {
  height: 180rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #9ca3af;
  font-size: 24rpx;
}

.history-item {
  min-height: 84rpx;
  display: flex;
  align-items: center;
  gap: 14rpx;
  border-bottom: 1rpx solid #f1f5f9;
}

.history-type {
  width: 62rpx;
  height: 44rpx;
  border-radius: 999rpx;
  background: #eef2ff;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #4f6ef7;
  font-size: 20rpx;
  font-weight: 850;
  flex-shrink: 0;
}

.history-main {
  flex: 1;
  min-width: 0;
}

.history-content {
  display: block;
  color: #111827;
  font-size: 24rpx;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.history-time {
  display: block;
  margin-top: 4rpx;
  color: #9ca3af;
  font-size: 20rpx;
}
</style>
