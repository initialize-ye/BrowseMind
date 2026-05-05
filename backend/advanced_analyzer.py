"""
BrowseMind 高级分析模块
包含时间黑洞检测和注意力曲线分析
"""

from typing import List, Dict, Tuple
from datetime import datetime, timedelta
from collections import defaultdict


class TimeBlackholeDetector:
    """时间黑洞检测器"""

    def __init__(self, threshold_minutes: int = 30):
        """
        初始化检测器

        Args:
            threshold_minutes: 时间黑洞阈值（分钟），默认30分钟
        """
        self.threshold_seconds = threshold_minutes * 60

    def detect(self, records: List[Dict]) -> Dict:
        """
        检测时间黑洞

        Args:
            records: 浏览记录列表

        Returns:
            {
                'blackholes': [黑洞列表],
                'total_wasted_time': 总浪费时间,
                'waste_percentage': 浪费时间占比,
                'top_blackholes': 前5个黑洞
            }
        """
        blackholes = []
        total_duration = 0
        total_wasted_time = 0

        # 按域名分组统计
        domain_stats = defaultdict(lambda: {
            'domain': '',
            'total_duration': 0,
            'visit_count': 0,
            'long_sessions': [],  # 长时间会话
            'category': ''
        })

        for record in records:
            domain = record.get('domain', '')
            duration = record.get('duration', 0)
            total_duration += duration

            if domain:
                domain_stats[domain]['domain'] = domain
                domain_stats[domain]['total_duration'] += duration
                domain_stats[domain]['visit_count'] += 1
                domain_stats[domain]['category'] = record.get('category', 'other')

                # 检测单次长时间访问
                if duration >= self.threshold_seconds:
                    domain_stats[domain]['long_sessions'].append({
                        'duration': duration,
                        'date': record.get('date', ''),
                        'title': record.get('title', ''),
                        'url': record.get('url', '')
                    })
                    total_wasted_time += duration

        # 识别时间黑洞
        for domain, stats in domain_stats.items():
            if stats['long_sessions']:
                blackhole = {
                    'domain': domain,
                    'category': stats['category'],
                    'total_duration': stats['total_duration'],
                    'visit_count': stats['visit_count'],
                    'long_sessions_count': len(stats['long_sessions']),
                    'longest_session': max(s['duration'] for s in stats['long_sessions']),
                    'sessions': stats['long_sessions'][:5]  # 只返回前5个
                }
                blackholes.append(blackhole)

        # 按总时长排序
        blackholes.sort(key=lambda x: x['total_duration'], reverse=True)

        # 计算浪费占比
        waste_percentage = (total_wasted_time / total_duration * 100) if total_duration > 0 else 0

        return {
            'blackholes': blackholes,
            'total_wasted_time': total_wasted_time,
            'waste_percentage': round(waste_percentage, 1),
            'top_blackholes': blackholes[:5],
            'threshold_minutes': self.threshold_seconds // 60
        }


class AttentionCurveAnalyzer:
    """注意力曲线分析器"""

    # 专注类别（工作/学习相关）
    FOCUS_CATEGORIES = {'learning', 'coding', 'tools'}

    # 娱乐类别
    ENTERTAINMENT_CATEGORIES = {'entertainment', 'social'}

    def analyze(self, records: List[Dict]) -> Dict:
        """
        分析注意力曲线

        Args:
            records: 浏览记录列表

        Returns:
            {
                'hourly_focus': [每小时专注度],
                'peak_hours': [高效时段],
                'low_hours': [低效时段],
                'focus_score': 总体专注度分数,
                'recommendations': [建议]
            }
        """
        # 按小时统计
        hourly_stats = defaultdict(lambda: {
            'total_duration': 0,
            'focus_duration': 0,
            'entertainment_duration': 0,
            'other_duration': 0
        })

        for record in records:
            # 解析访问时间
            visit_time = record.get('visit_time')
            if isinstance(visit_time, str):
                try:
                    dt = datetime.fromisoformat(visit_time.replace('Z', '+00:00'))
                except:
                    continue
            elif isinstance(visit_time, (int, float)):
                dt = datetime.fromtimestamp(visit_time / 1000)
            else:
                continue

            hour = dt.hour
            duration = record.get('duration', 0)
            category = record.get('category', 'other')

            hourly_stats[hour]['total_duration'] += duration

            if category in self.FOCUS_CATEGORIES:
                hourly_stats[hour]['focus_duration'] += duration
            elif category in self.ENTERTAINMENT_CATEGORIES:
                hourly_stats[hour]['entertainment_duration'] += duration
            else:
                hourly_stats[hour]['other_duration'] += duration

        # 计算每小时专注度分数（0-100）
        hourly_focus = []
        for hour in range(24):
            stats = hourly_stats[hour]
            total = stats['total_duration']

            if total > 0:
                focus_ratio = stats['focus_duration'] / total
                entertainment_ratio = stats['entertainment_duration'] / total

                # 专注度分数 = 专注时间占比 * 100 - 娱乐时间占比 * 50
                score = focus_ratio * 100 - entertainment_ratio * 50
                score = max(0, min(100, score))  # 限制在 0-100
            else:
                score = 0

            hourly_focus.append({
                'hour': hour,
                'score': round(score, 1),
                'total_duration': total,
                'focus_duration': stats['focus_duration'],
                'entertainment_duration': stats['entertainment_duration']
            })

        # 识别高效和低效时段
        active_hours = [h for h in hourly_focus if h['total_duration'] > 0]
        if active_hours:
            avg_score = sum(h['score'] for h in active_hours) / len(active_hours)

            peak_hours = [h for h in active_hours if h['score'] >= avg_score + 20]
            low_hours = [h for h in active_hours if h['score'] <= avg_score - 20]
        else:
            avg_score = 0
            peak_hours = []
            low_hours = []

        # 生成建议
        recommendations = self._generate_recommendations(peak_hours, low_hours, hourly_focus)

        return {
            'hourly_focus': hourly_focus,
            'peak_hours': [h['hour'] for h in peak_hours],
            'low_hours': [h['hour'] for h in low_hours],
            'focus_score': round(avg_score, 1),
            'recommendations': recommendations
        }

    def _generate_recommendations(
        self,
        peak_hours: List[Dict],
        low_hours: List[Dict],
        hourly_focus: List[Dict]
    ) -> List[str]:
        """生成优化建议"""
        recommendations = []

        if peak_hours:
            peak_time_ranges = self._format_time_ranges([h['hour'] for h in peak_hours])
            recommendations.append(
                f"你的高效时段是 {peak_time_ranges}，建议在这些时间处理重要工作"
            )

        if low_hours:
            low_time_ranges = self._format_time_ranges([h['hour'] for h in low_hours])
            recommendations.append(
                f"你在 {low_time_ranges} 容易分心，建议减少娱乐网站访问"
            )

        # 检查早晨效率
        morning_hours = [h for h in hourly_focus if 6 <= h['hour'] <= 11 and h['total_duration'] > 0]
        if morning_hours:
            morning_avg = sum(h['score'] for h in morning_hours) / len(morning_hours)
            if morning_avg < 50:
                recommendations.append("早晨效率较低，建议调整作息或减少早晨的娱乐时间")

        # 检查深夜浏览
        late_night = [h for h in hourly_focus if h['hour'] >= 23 or h['hour'] <= 2]
        late_night_duration = sum(h['total_duration'] for h in late_night)
        if late_night_duration > 3600:  # 超过1小时
            recommendations.append("深夜浏览时间较长，建议早点休息以保证第二天效率")

        if not recommendations:
            recommendations.append("保持当前的浏览习惯，继续加油！")

        return recommendations

    def _format_time_ranges(self, hours: List[int]) -> str:
        """格式化时间范围"""
        if not hours:
            return ""

        hours = sorted(hours)
        ranges = []
        start = hours[0]
        end = hours[0]

        for i in range(1, len(hours)):
            if hours[i] == end + 1:
                end = hours[i]
            else:
                ranges.append(f"{start}:00-{end+1}:00")
                start = hours[i]
                end = hours[i]

        ranges.append(f"{start}:00-{end+1}:00")
        return "、".join(ranges)


class AdvancedAnalyzer:
    """高级分析器（整合所有分析功能）"""

    def __init__(self, blackhole_threshold: int = 30):
        """
        初始化分析器

        Args:
            blackhole_threshold: 时间黑洞阈值（分钟）
        """
        self.blackhole_detector = TimeBlackholeDetector(blackhole_threshold)
        self.attention_analyzer = AttentionCurveAnalyzer()

    def analyze_all(self, records: List[Dict]) -> Dict:
        """
        执行所有高级分析

        Args:
            records: 浏览记录列表

        Returns:
            完整的分析结果
        """
        return {
            'blackholes': self.blackhole_detector.detect(records),
            'attention_curve': self.attention_analyzer.analyze(records)
        }
