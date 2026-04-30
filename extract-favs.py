import re

dump_file = r"c:\Users\simon\yeh2\yeh_live_2026-04-08_1600_compat.sql"

# Read dump
with open(dump_file, 'r', encoding='utf-8', errors='ignore') as f:
    content = f.read()

# Find all INSERT INTO favourites statements
pattern = r"INSERT INTO `?favourites`?\s+(?:VALUES\s*)?(\([^;]+\);)"
matches = re.findall(pattern, content, re.IGNORECASE | re.MULTILINE | re.DOTALL)

print(f"Found {len(matches)} favourites insert statements")
if matches:
    print(f"First: {matches[0][:150]}...")
    
    # Write to SQL file
    with open(r"c:\Users\simon\yeh2\restore-fav.sql", 'w') as f:
        for match in matches:
            f.write(f"INSERT INTO `favourites` VALUES {match}\n")
    print(f"Wrote to restore-fav.sql")
