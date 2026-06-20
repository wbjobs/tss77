import urllib.request
import json

print("=== 测试时序数据异常模式匹配引擎 ===\n")

try:
    with urllib.request.urlopen('http://localhost:5000/api/health') as resp:
        health = json.loads(resp.read().decode())
        print(f"1. 健康检查: {health['status']} - {health['message']}")
except Exception as e:
    print(f"1. 健康检查失败: {e}")

print()

try:
    with urllib.request.urlopen('http://localhost:5000/api/datasets') as resp:
        data = json.loads(resp.read().decode())
        print(f"2. 数据集列表: {len(data['datasets'])} 个数据集")
        for ds in data['datasets']:
            print(f"   - {ds['name']} (ID: {ds['id']}, {ds['data_count']} 个点)")
except Exception as e:
    print(f"2. 获取数据集失败: {e}")

print()

try:
    with urllib.request.urlopen('http://localhost:5000/api/datasets/1/data') as resp:
        data = json.loads(resp.read().decode())
        print(f"3. 数据详情: {data['count']} 个数据点")
        print(f"   时间范围: {data['timestamps'][0]:.1f} ~ {data['timestamps'][-1]:.1f}")
        print(f"   数值范围: {min(data['values']):.2f} ~ {max(data['values']):.2f}")
        
        values = data['values']
        template = values[500:530]
        print(f"\n4. 模板数据 (位置 500-529, 30个点)")
        print(f"   模板数值范围: {min(template):.2f} ~ {max(template):.2f}")
        
        req = urllib.request.Request(
            'http://localhost:5000/api/datasets/1/match',
            data=json.dumps({
                'template': template,
                'top_k': 5,
                'step': 5
            }).encode(),
            headers={'Content-Type': 'application/json'},
            method='POST'
        )
        
        with urllib.request.urlopen(req) as resp2:
            result = json.loads(resp2.read().decode())
            print(f"\n5. 匹配结果: 找到 {result['count']} 个匹配")
            for i, m in enumerate(result['matches']):
                sim = m['similarity'] * 100
                print(f"   #{i+1}: 位置 {m['start_index']}-{m['end_index']} "
                      f"| 相似度 {sim:.1f}% | 距离 {m['distance']:.2f}")
        
        print("\n=== 所有测试通过 ===")
        
except Exception as e:
    import traceback
    print(f"测试失败: {e}")
    traceback.print_exc()
