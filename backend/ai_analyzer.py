"""
BrowseMind AI 分析模块
支持 OpenAI 和 DeepSeek API
"""

import os
from typing import List, Dict
import json


class AIAnalyzer:
    """AI 分析器"""

    def __init__(self, api_key: str = None, provider: str = "deepseek", model: str = None):
        """
        初始化 AI 分析器

        Args:
            api_key: API 密钥
            provider: AI 提供商 (openai, deepseek)
            model: 模型名称（可选，默认使用推荐模型）
        """
        self.api_key = api_key or os.getenv("AI_API_KEY")
        self.provider = provider.lower()

        if self.provider == "openai":
            from openai import OpenAI
            self.client = OpenAI(api_key=self.api_key)
            self.model = model or os.getenv("AI_MODEL", "gpt-4o-mini")
        elif self.provider == "deepseek":
            from openai import OpenAI
            self.client = OpenAI(
                api_key=self.api_key,
                base_url="https://api.deepseek.com/v1"
            )
            self.model = model or os.getenv("AI_MODEL", "deepseek-chat")
        else:
            raise ValueError(f"不支持的 AI 提供商: {provider}")

    def analyze_browsing_behavior(
        self,
        category_stats: List[Dict],
        total_duration: int,
        top_domains: List[Dict],
        date_range: str = "7天"
    ) -> Dict[str, any]:
        """
        分析浏览行为

        Args:
            category_stats: 分类统计
            total_duration: 总时长（秒）
            top_domains: 热门网站
            date_range: 时间范围

        Returns:
            分析结果字典
        """
        # 构建 prompt
        prompt = self._build_analysis_prompt(
            category_stats, total_duration, top_domains, date_range
        )

        try:
            # 调用 AI API
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {
                        "role": "system",
                        "content": "你是一个专业的时间管理和行为分析专家，擅长分析用户的浏览行为并提供优化建议。"
                    },
                    {
                        "role": "user",
                        "content": prompt
                    }
                ],
                temperature=0.7,
                max_tokens=1500
            )

            # 解析响应
            content = response.choices[0].message.content
            result = self._parse_ai_response(content)

            return result

        except Exception as e:
            print(f"AI 分析失败: {e}")
            return self._get_fallback_analysis(category_stats, total_duration)

    def _build_analysis_prompt(
        self,
        category_stats: List[Dict],
        total_duration: int,
        top_domains: List[Dict],
        date_range: str
    ) -> str:
        """构建分析 prompt"""

        # 格式化时长
        hours = total_duration // 3600
        minutes = (total_duration % 3600) // 60

        # 格式化分类统计
        category_text = "\n".join([
            f"- {self._get_category_name(stat['category'])}: "
            f"{stat['percentage']}% ({stat['total_duration'] // 60}分钟, {stat['visits']}次访问)"
            for stat in category_stats[:5]
        ])

        # 格式化热门网站
        domain_text = "\n".join([
            f"- {domain['domain']}: {domain['visits']}次访问, "
            f"{domain['total_duration'] // 60}分钟"
            for domain in top_domains[:5]
        ])

        prompt = f"""
请分析以下用户的浏览行为数据（{date_range}）：

## 总体统计
- 总浏览时长: {hours}小时{minutes}分钟
- 总访问次数: {sum(s['visits'] for s in category_stats)}次

## 分类占比
{category_text}

## 热门网站
{domain_text}

请按以下格式提供分析：

1. **行为总结**（2-3句话概括用户的浏览习惯）

2. **发现的问题**（列出2-3个主要问题，如果没有问题就说"暂无明显问题"）
   - 问题1
   - 问题2

3. **优化建议**（提供3-5条具体可行的建议）
   - 建议1
   - 建议2
   - 建议3

请用简洁、友好的语气，避免说教。
"""
        return prompt

    def _parse_ai_response(self, content: str) -> Dict[str, any]:
        """解析 AI 响应"""

        lines = content.strip().split('\n')

        summary = ""
        issues = []
        suggestions = []

        current_section = None

        for line in lines:
            line = line.strip()
            if not line:
                continue

            # 识别章节（宽松匹配）
            lower = line.lower()
            if any(kw in line for kw in ["行为总结", "总结", "概览", "概述"]):
                current_section = "summary"
                continue
            elif any(kw in line for kw in ["问题", "发现", "不足", "风险"]):
                current_section = "issues"
                continue
            elif any(kw in line for kw in ["建议", "优化", "改进", "推荐"]):
                current_section = "suggestions"
                continue

            # 提取内容
            if current_section == "summary":
                cleaned = line.lstrip('#*- ').strip()
                # 跳过编号列表项（如 "1. xxx"），只取连续文本
                if cleaned and not cleaned[0].isdigit():
                    summary += cleaned + " "
            elif current_section == "issues":
                if line.startswith(('-', '•', '*')) or (line and line[0].isdigit()):
                    issue = line.lstrip('-•*0123456789. )）').strip()
                    if issue and issue not in issues:
                        issues.append(issue)
            elif current_section == "suggestions":
                if line.startswith(('-', '•', '*')) or (line and line[0].isdigit()):
                    suggestion = line.lstrip('-•*0123456789. )）').strip()
                    if suggestion and suggestion not in suggestions:
                        suggestions.append(suggestion)

        return {
            "summary": summary.strip() or "您的浏览习惯总体良好。",
            "issues": issues if issues else ["暂无明显问题"],
            "suggestions": suggestions if suggestions else [
                "保持当前的浏览习惯",
                "定期回顾时间分配",
                "设置明确的学习目标"
            ]
        }

    def _get_fallback_analysis(
        self,
        category_stats: List[Dict],
        total_duration: int
    ) -> Dict[str, any]:
        """获取备用分析（当 AI 调用失败时）"""

        # 基于规则的简单分析
        entertainment_pct = next(
            (s['percentage'] for s in category_stats if s['category'] == 'entertainment'),
            0
        )

        learning_pct = next(
            (s['percentage'] for s in category_stats if s['category'] == 'learning'),
            0
        )

        issues = []
        suggestions = []

        # 判断问题
        if entertainment_pct > 40:
            issues.append("娱乐类网站占比较高，可能影响工作效率")
            suggestions.append("尝试设置娱乐时间限制，比如每天不超过2小时")

        if learning_pct < 20:
            issues.append("学习类网站访问较少")
            suggestions.append("增加学习时间，每天至少安排1小时用于学习")

        if total_duration > 8 * 3600:
            issues.append("每日浏览时间过长，注意休息")
            suggestions.append("每隔1小时休息10分钟，保护视力")

        if not issues:
            issues = ["暂无明显问题，浏览习惯良好"]

        if not suggestions:
            suggestions = [
                "保持当前的浏览习惯",
                "定期回顾时间分配",
                "设置明确的目标"
            ]

        top_cat = category_stats[0]['category'] if category_stats else '其他'
        return {
            "summary": f"您在过去7天的浏览时长为{total_duration // 3600}小时，"
                      f"主要集中在{top_cat}类网站。",
            "issues": issues,
            "suggestions": suggestions
        }

    def _get_category_name(self, category: str) -> str:
        """获取分类中文名"""
        names = {
            "learning": "学习",
            "coding": "编程",
            "entertainment": "娱乐",
            "social": "社交",
            "tools": "工具",
            "other": "其他"
        }
        return names.get(category, category)


# 测试代码
if __name__ == "__main__":
    # 测试数据
    test_category_stats = [
        {"category": "coding", "percentage": 35.5, "total_duration": 7200, "visits": 50},
        {"category": "learning", "percentage": 25.0, "total_duration": 5000, "visits": 30},
        {"category": "entertainment", "percentage": 20.0, "total_duration": 4000, "visits": 40},
        {"category": "social", "percentage": 15.0, "total_duration": 3000, "visits": 25},
        {"category": "tools", "percentage": 4.5, "total_duration": 900, "visits": 15},
    ]

    test_top_domains = [
        {"domain": "github.com", "visits": 30, "total_duration": 3600},
        {"domain": "stackoverflow.com", "visits": 20, "total_duration": 2400},
        {"domain": "youtube.com", "visits": 25, "total_duration": 3000},
    ]

    # 使用备用分析测试
    analyzer = AIAnalyzer(api_key="test", provider="deepseek")
    result = analyzer._get_fallback_analysis(test_category_stats, 20200)

    print("分析结果:")
    print(f"总结: {result['summary']}")
    print(f"\n问题:")
    for issue in result['issues']:
        print(f"  - {issue}")
    print(f"\n建议:")
    for suggestion in result['suggestions']:
        print(f"  - {suggestion}")
