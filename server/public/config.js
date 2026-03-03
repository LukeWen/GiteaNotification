const $ = (s) => document.querySelector(s);

// 全局变量存储Gitea基础URL
let GITEA_BASE_URL = 'http://localhost:3000';

// 假日管理
let ontarioHolidays = [];

// 加载安省假日
function loadOntarioHolidays() {
  const saved = localStorage.getItem('ontarioHolidays');
  const version = localStorage.getItem('ontarioHolidaysVersion');

  // 检查版本，如果不是最新版本或没有数据，重新生成
  if (!saved || version !== '2026-2030') {
    // 预置2026-2030年安省假日
    ontarioHolidays = generateOntarioHolidays2026to2030();
    saveOntarioHolidays();
    localStorage.setItem('ontarioHolidaysVersion', '2026-2030');
    console.log(`Generated ${ontarioHolidays.length} Ontario holidays for 2026-2030`);
  } else {
    ontarioHolidays = JSON.parse(saved);
    console.log(`Loaded ${ontarioHolidays.length} Ontario holidays from storage`);
  }
}

// 生成2026-2030年安省假日
function generateOntarioHolidays2026to2030() {
  const holidays = [];

  // 安省假日类型和计算规则
  const holidayTypes = [
    { name: "New Year's Day", month: 1, day: 1, type: "fixed" },
    { name: "Family Day", month: 2, day: null, type: "monday" }, // 2月第三个周一
    { name: "Good Friday", month: 3, day: null, type: "easter" }, // 复活节前两天
    { name: "Easter Monday", month: 4, day: null, type: "easter" }, // 复活节后一天
    { name: "Victoria Day", month: 5, day: null, type: "monday" }, // 5月最后一个周一
    { name: "Canada Day", month: 7, day: 1, type: "fixed" },
    { name: "Civic Holiday", month: 8, day: null, type: "monday" }, // 8月第一个周一
    { name: "Labour Day", month: 9, day: null, type: "monday" }, // 9月第一个周一
    { name: "Thanksgiving Day", month: 10, day: null, type: "monday" }, // 10月第二个周一
    { name: "Remembrance Day", month: 11, day: 11, type: "fixed" },
    { name: "Christmas Day", month: 12, day: 25, type: "fixed" },
    { name: "Boxing Day", month: 12, day: 26, type: "fixed" }
  ];

  for (let year = 2026; year <= 2030; year++) {
    holidayTypes.forEach(holiday => {
      let date;

      if (holiday.type === "fixed") {
        date = `${year}-${String(holiday.month).padStart(2, '0')}-${String(holiday.day).padStart(2, '0')}`;
      } else if (holiday.type === "monday") {
        if (holiday.name === "Victoria Day") {
          // 5月最后一个周一
          date = getLastMondayOfMonth(year, 5);
        } else if (holiday.name === "Labour Day" || holiday.name === "Civic Holiday") {
          // 8/9月第一个周一
          date = getFirstMondayOfMonth(year, holiday.month);
        } else if (holiday.name === "Thanksgiving Day") {
          // 10月第二个周一
          date = getSecondMondayOfMonth(year, 10);
        } else if (holiday.name === "Family Day") {
          // 2月第三个周一
          date = getThirdMondayOfMonth(year, 2);
        }
      } else if (holiday.type === "easter") {
        const easterDate = calculateEaster(year);
        if (holiday.name === "Good Friday") {
          // 复活节前两天
          const gdFriday = new Date(easterDate);
          gdFriday.setDate(gdFriday.getDate() - 2);
          date = gdFriday.toISOString().split('T')[0];
        } else if (holiday.name === "Easter Monday") {
          // 复活节后一天
          const easterMonday = new Date(easterDate);
          easterMonday.setDate(easterMonday.getDate() + 1);
          date = easterMonday.toISOString().split('T')[0];
        }
      }

      if (date) {
        holidays.push({ date, name: holiday.name });
      }
    });
  }

  return holidays;
}

// 计算复活节日期
function calculateEaster(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const n = Math.floor((h + l - 7 * m + 114) / 31);
  const p = (h + l - 7 * m + 114) % 31;

  return new Date(year, n - 1, p + 1);
}

// 获取某月最后一个周一
function getLastMondayOfMonth(year, month) {
  const lastDay = new Date(year, month, 0); // 月份的最后一天
  const dayOfWeek = lastDay.getDay();
  const daysToSubtract = (dayOfWeek + 6) % 7; // 计算到上一个周一的天数
  const lastMonday = new Date(year, month - 1, lastDay.getDate() - daysToSubtract);
  return lastMonday.toISOString().split('T')[0];
}

// 获取某月第一个周一
function getFirstMondayOfMonth(year, month) {
  const firstDay = new Date(year, month - 1, 1);
  const dayOfWeek = firstDay.getDay();
  const daysToAdd = dayOfWeek === 0 ? 1 : 8 - dayOfWeek; // 如果周日则加1天，否则计算到下一个周一
  const firstMonday = new Date(year, month - 1, 1 + daysToAdd);
  return firstMonday.toISOString().split('T')[0];
}

// 获取某月第二个周一
function getSecondMondayOfMonth(year, month) {
  const firstMonday = new Date(getFirstMondayOfMonth(year, month));
  const secondMonday = new Date(firstMonday);
  secondMonday.setDate(firstMonday.getDate() + 7);
  return secondMonday.toISOString().split('T')[0];
}

// 获取某月第三个周一
function getThirdMondayOfMonth(year, month) {
  const firstMonday = new Date(getFirstMondayOfMonth(year, month));
  const thirdMonday = new Date(firstMonday);
  thirdMonday.setDate(firstMonday.getDate() + 14);
  return thirdMonday.toISOString().split('T')[0];
}

// 保存安省假日
function saveOntarioHolidays() {
  localStorage.setItem('ontarioHolidays', JSON.stringify(ontarioHolidays));
}

// 检查是否为工作日（排除周末和假日）
function isWorkday(date) {
  const dayOfWeek = date.getDay();
  if (dayOfWeek === 0 || dayOfWeek === 6) return false; // 周末

  const dateStr = date.toISOString().split('T')[0];
  return !ontarioHolidays.some(holiday => holiday.date === dateStr);
}

// 计算两个日期之间的工作日数量
function getWorkdaysBetween(startDate, endDate) {
  let count = 0;
  const current = new Date(startDate);
  const end = new Date(endDate);

  while (current <= end) {
    if (isWorkday(current)) {
      count++;
    }
    current.setDate(current.getDate() + 1);
  }
  return count;
}

// 按工作日分配时间
function distributeTimeByWorkdays(totalSeconds, startDate, endDate) {
  const workdays = getWorkdaysBetween(startDate, endDate);
  if (workdays === 0) return 0;
  return totalSeconds / workdays;
}

// 检查日期是否在指定时间段内
function isDateInRange(year, month, startYear, startMonth, endYear, endMonth) {
  // 将年月转换为可比较的数字
  const dateValue = year * 100 + month;
  const startValue = startYear * 100 + startMonth;
  const endValue = endYear * 100 + endMonth;

  return dateValue >= startValue && dateValue <= endValue;
}

// 初始化时获取Gitea基础URL
async function initGiteaConfig() {
  try {
    const response = await fetch('/api/config');
    const config = await response.json();
    GITEA_BASE_URL = config.giteaBaseUrl || '';
    window.GITEA_BASE_URL = GITEA_BASE_URL; // 也设置到window对象上以保持兼容性
  } catch (error) {
    console.error('Failed to load Gitea config:', error);
    GITEA_BASE_URL = '';
    window.GITEA_BASE_URL = '';
  }
}

// 根据背景色自动选择文字颜色（白色或黑色）
function getContrastColor(hexColor) {
  // 移除#号并确保是6位十六进制
  let hex = hexColor.replace('#', '');
  if (hex.length === 3) {
    hex = hex.split('').map(char => char + char).join('');
  }

  // 转换为RGB
  const r = parseInt(hex.substr(0, 2), 16);
  const g = parseInt(hex.substr(2, 2), 16);
  const b = parseInt(hex.substr(4, 2), 16);

  // 计算相对亮度 (使用W3C标准公式)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

  // 如果背景较亮，使用黑色文字；如果背景较暗，使用白色文字
  return luminance > 0.5 ? '#000000' : '#ffffff';
}
