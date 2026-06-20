import urllib.request
import json

print("=== 测试后端参数校验 ===\n")

base_url = 'http://localhost:5000/api'

def test_case(name, template_data, expected_error=None):
    print(f"测试: {name}")
    try:
        req = urllib.request.Request(
            f'{base_url}/datasets/1/match',
            data=json.dumps(template_data).encode(),
            headers={'Content-Type': 'application/json'},
            method='POST'
        )
        with urllib.request.urlopen(req) as resp:
            result = json.loads(resp.read().decode())
            if result['success']:
                print(f"  ✓ 成功 - 找到 {result['count']} 个匹配")
                return True
            else:
                print(f"  ✗ 失败 - {result.get('error', '未知错误')}")
                return False
    except urllib.error.HTTPError as e:
        error_data = json.loads(e.read().decode())
        print(f"  ✗ HTTP {e.code} - {error_data.get('error', '未知错误')}")
        if expected_error and expected_error in error_data.get('error', ''):
            print(f"  ✓ 符合预期: {expected_error}")
            return True
        return False
    except Exception as e:
        print(f"  ✗ 异常: {e}")
        return False

print("1. 正常数据测试:")
test_case(
    "有效的模板数据（30个点）",
    {'template': list(range(500, 530)), 'top_k': 5, 'step': 5}
)

print("\n2. 异常数据测试:")
test_case("空模板", {'template': []}, "不能为空")
test_case("模板数据过少（3个点）", {'template': [1, 2, 3]}, "至少需要5个点")
test_case("包含无效数值", {'template': [1, 2, 'abc', 4, 5]}, "无效数值")
test_case("所有数值相同", {'template': [5, 5, 5, 5, 5, 5]}, "无变化")
test_case("top_k为0", {'template': list(range(10)), 'top_k': 0}, "正整数")
test_case("step为0", {'template': list(range(10)), 'step': 0}, "正整数")
test_case("负的阈值", {'template': list(range(10)), 'threshold': -1}, "无效")

print("\n=== 测试完成 ===")
