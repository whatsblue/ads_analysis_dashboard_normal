<script setup lang="ts">
/**
 * 全局筛选栏（迁移自原型 filter-bar）：日期（双月日历）/销售站点/广告账号（两栏）/环比开关+设置/应用/重置。
 * 全部编辑 filter.draft；【应用】三态（蓝=待应用/灰=已应用）；重置=数据窗口默认并立即生效。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { SITES, useFilterStore } from '@/stores/filter';
import { useDataStore } from '@/stores/data';
import CalendarPicker from './CalendarPicker.vue';
import MultiDropdown from './MultiDropdown.vue';
import CmpModal from './CmpModal.vue';

const filter = useFilterStore();
const data = useDataStore();
const route = useRoute();
const d = filter.draft;

/* ================= 日期 ================= */
const dateOpen = ref(false);

function onPicked(s: string, e: string): void {
  d.start = s;
  d.end = e;
  dateOpen.value = false;
}

/* ================= 账号两栏（左渠道导航/右账号列表） ================= */
const accOpen = ref(false);
const accCur = ref<'meta' | 'google'>('meta');
const accQ = ref('');
const accActive = ref<'meta' | 'google' | ''>('');

const lv1 = computed<'ca' | 'meta' | 'google'>(() => {
  if (route.path === '/' ) return 'ca';
  if (route.path.startsWith('/meta/')) return 'meta';
  if (route.path.startsWith('/google/')) return 'google';
  return 'ca';
});

const accNavs = computed(() =>
  lv1.value === 'meta' ? ([['meta', 'Meta']] as const) : lv1.value === 'google' ? ([['google', 'Google']] as const) : ([['meta', 'Meta'], ['google', 'Google']] as const),
);

const accItems = computed(() => (accCur.value === 'meta' ? data.metaAccounts : data.gAccounts));

function kwMatch(q: string, lb: string): boolean {
  if (!q) return true;
  const s = lb.toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .every((t) => (t.charAt(0) === '-' ? (t.length > 1 ? !s.includes(t.slice(1)) : true) : s.includes(t)));
}

const accShown = computed(() => accItems.value.filter((a) => kwMatch(accQ.value, a)));
const accSel = computed<string[]>(() => (accCur.value === 'meta' ? d.metaSel : d.gSel));
const accExcl = computed(() => (accCur.value === 'meta' ? d.metaExcl : d.gExcl));

function openAcc(): void {
  accOpen.value = !accOpen.value;
  if (accOpen.value) {
    accQ.value = '';
    if (lv1.value !== 'ca') accCur.value = lv1.value;
  }
}

function setAccSel(v: string[]): void {
  if (accCur.value === 'meta') d.metaSel = v;
  else d.gSel = v;
  accActive.value = v.length ? accCur.value : accActive.value;
  if (!d.metaSel.length && !d.gSel.length && !d.metaExcl && !d.gExcl) accActive.value = '';
}

function setAccExcl(v: boolean): void {
  if (accCur.value === 'meta') d.metaExcl = v;
  else d.gExcl = v;
  if (v) accActive.value = accCur.value;
}

function toggleAcc(a: string, on: boolean): void {
  const cur = accSel.value.slice();
  const i = cur.indexOf(a);
  if (on && i < 0) cur.push(a);
  if (!on && i >= 0) cur.splice(i, 1);
  setAccSel(cur);
}

function toggleAccAll(on: boolean): void {
  setAccSel(on ? accShown.value.slice() : []);
}

function accPart(sel: string[], ex: boolean, items: string[]): string {
  if (ex && sel.length) return '排除 ' + sel.length + ' 项';
  if (!sel.length || sel.length === items.length) return '全';
  return sel.slice(0, 1).join(',') + (sel.length > 1 ? ' 等' + sel.length + '项' : '');
}

const accBtnText = computed(() => {
  const a =
    lv1.value === 'meta'
      ? d.metaSel.length || d.metaExcl
        ? 'meta'
        : ''
      : lv1.value === 'google'
        ? d.gSel.length || d.gExcl
          ? 'google'
          : ''
        : accActive.value || (d.metaSel.length || d.metaExcl ? 'meta' : d.gSel.length || d.gExcl ? 'google' : '');
  if (!a) return '请选择';
  const p = a === 'meta' ? accPart(d.metaSel, d.metaExcl, data.metaAccounts) : accPart(d.gSel, d.gExcl, data.gAccounts);
  return (a === 'meta' ? 'Meta' : 'Google') + ' 账号' + (p === '全' ? '' : '（' + p + '）');
});

/* ================= 环比 ================= */
const cmpOpen = ref(false);

function onCmpSwitch(on: boolean): void {
  d.cmpOn = on;
  if (on) cmpOpen.value = true;
  else d.cmpEd = null;
}

/** 环比设置按钮三态：蓝=有未应用更改 / 灰=开启已应用 / 白=关闭已应用 */
const cmpBtnCls = computed(() => {
  const dirtyCmp = JSON.stringify([d.cmpOn, d.cmpT, d.cmpN, d.cmpEd]) !==
    JSON.stringify([filter.applied.cmpOn, filter.applied.cmpT, filter.applied.cmpN, filter.applied.cmpEd]);
  if (dirtyCmp) return 'pri';
  return filter.applied.cmpOn ? 'done' : '';
});

/* ================= 应用 / 重置 ================= */
function apply(): void {
  filter.apply();
  dateOpen.value = false;
}

function reset(): void {
  const m = data.manifest;
  if (m) filter.reset(m.range.viewStart, m.range.viewEnd);
  filter.apply();
}

/* ================= 外点关闭 ================= */
function onDocClick(ev: MouseEvent): void {
  const t = ev.target as HTMLElement;
  if (dateOpen.value && !t.closest('.dd-date')) dateOpen.value = false;
  if (accOpen.value && !t.closest('.dd-acc')) accOpen.value = false;
}

onMounted(() => document.addEventListener('click', onDocClick));
onBeforeUnmount(() => document.removeEventListener('click', onDocClick));
</script>

<template>
  <div class="filter-bar">
    <div class="fd dd dd-date" :class="{ open: dateOpen }">
      <b>日期范围</b>
      <button type="button" style="min-width: 232px" @click.stop="dateOpen = !dateOpen">{{ d.start }} ~ {{ d.end }}</button>
      <div v-if="dateOpen" class="dd-panel dr-panel" @click.stop>
        <CalendarPicker :start="d.start" :end="d.end" @picked="onPicked" />
      </div>
    </div>

    <div class="fd dd">
      <b>销售站点</b>
      <MultiDropdown
        :items="SITES"
        :selected="d.siteSel"
        :excl="d.siteExcl"
        all-name="站点"
        @change="(sel, excl) => ((d.siteSel = sel), (d.siteExcl = excl))"
      />
    </div>

    <div class="fd dd dd-acc" :class="{ open: accOpen }">
      <b>广告账号</b>
      <button type="button" style="min-width: 170px" @click.stop="openAcc()">{{ accBtnText }}</button>
      <div v-if="accOpen" class="dd-panel" @click.stop>
        <div class="acc-two">
          <div class="acc-nav" v-show="accNavs.length > 1">
            <button v-for="nv in accNavs" :key="nv[0]" :class="{ on: accCur === nv[0] }" @click="accCur = nv[0]; accQ = ''">
              {{ nv[1] }}
            </button>
          </div>
          <div class="acc-list">
            <input class="dd-search" v-model="accQ" placeholder="搜索…" />
            <div class="acc-tip">
              {{
                accNavs.length > 1
                  ? 'Meta 与 Google 账号分别作用于各自页签：点击左侧渠道名仅切换账号列表（进入面板默认全部未选）'
                  : '当前页签仅筛选 ' + (accCur === 'meta' ? 'Meta' : 'Google') + ' 账号（进入面板默认全部未选）'
              }}
            </div>
            <div class="dd-tools">
              <label>
                <input type="checkbox" :checked="accSel.length === accItems.length && accItems.length > 0" @change="toggleAccAll(($event.target as HTMLInputElement).checked)" />全选
              </label>
              <label><input type="checkbox" :checked="accExcl" @change="setAccExcl(($event.target as HTMLInputElement).checked)" />排除</label>
            </div>
            <label v-for="a in accShown" :key="a">
              <input type="checkbox" :value="a" :checked="accSel.includes(a)" @change="toggleAcc(a, ($event.target as HTMLInputElement).checked)" />
              {{ a }}
            </label>
          </div>
        </div>
      </div>
    </div>

    <label class="switch">
      <input type="checkbox" v-model="d.cmpOn" @change="onCmpSwitch(($event.target as HTMLInputElement).checked)" />
      开启环比
    </label>
    <button type="button" class="btn" :class="cmpBtnCls" @click="cmpOpen = true">环比设置</button>
    <button type="button" class="btn" :class="filter.dirty ? 'pri' : 'done'" @click="apply()">应用</button>
    <button type="button" class="btn" @click="reset()">重置</button>
  </div>
  <CmpModal :open="cmpOpen" @close="cmpOpen = false" />
</template>
