import urllib.request
import json

print("=== 测试幅度范围过滤功能 ===\n")

base_url = 'http://localhost:5000/api'

with urllib.request.urlopen(f'{base_url}/datasets/1/data') as resp:
    data = json.loads(resp.read().decode())
    values = data['values']
    print(f"时序数据: {len(values)} 个点")
    print(f"数值范围: {min(values):.2f} ~ {max(values):.2f}")

    template_start = 500
    template_end = 530
    template = values[template_start:template_end]
    print(f"\n模板 (位置 {template_start}-{template_end}):")
    print(f"  长度: {len(template)}")
    print(f"  范围: {min(template):.2f} ~ {max(template):.2f}")
    t_range = max(template) - min(template)
    print(f"  幅度差: {t_range:.2f}\n")


def test_match(name, amp_tolerance=None):
    print(f"测试: {name}")
    payload = {
        'template': template,
        'top_k': 10,
        'step': 5
    }
    if amp_tolerance is not None:
        payload['amplitude_tolerance'] = amp_tolerance

    if amp_tolerance is not None:
        tol_min = min(template) - t_range * amp_tolerance / 100
        tol_max = max(template) + t_range * amp_tolerance / 100
        print(f"  允许范围: {tol_min:.2f} ~ {tol_max:.2f}")

    try:
        req = urllib.request.Request(
            f'{base_url}/datasets/1/match',
            data=json.dumps(payload).encode(),
            headers={'Content-Type': 'application/json'},
            method='POST'
        )
        with urllib.request.urlopen(req) as resp:
            result = json.loads(resp.read().decode())
            if result['success']:
                print(f"  ✓ 找到 {result['count']} 个匹配")
                for i, m in enumerate(result['matches'][:5]):
                    extra = ""
                    if 'segment_min' in m:
                        extra = f" | 幅度: {m['segment_min']:.1f}-{m['segment_max']:.1f}"
                    print(f"    #{i+1}: 位置 {m['start_index']} | 相似度 {m['similarity']*100:.1f}%{extra}")

                if 'allowed_min' in result:
                    print(f"  允许范围: {result['allowed_min']:.2f} ~ {result['allowed_max']:.2f}")
                    print(f"  模板范围: {result['template_min']:.2f} ~ {result['template_max']:.2f}")
                return True
            else:
                print(f"  ✗ 失败: {result.get('error')}")
                return False
    except Exception as e:
        print(f"  ✗ 异常: {e}")
        return False

print("1. 不启用幅度过滤 (仅按形状):")
test_match("形状匹配 (不限幅度)", None)

print("\n2. 严格幅度过滤 (±5%):")
test_match("幅度严格过滤 (±5%)", 5)

print("\n3. 中等幅度过滤 (±30%):")
test_match("幅度中等过滤 (±30%)", 30)

print("\n4. 宽松幅度过滤 (±100%):")
test_match("幅度宽松过滤 (±100%)", 100)

print("\n5. 幅度值为0 (完全匹配幅度):")
test_match("幅度完全匹配 (±0%)", 0)

print("\n=== 测试完成 ===")
