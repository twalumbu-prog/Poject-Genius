import re

with open('src/pages/teacher/MarkTest.jsx', 'r') as f:
    content = f.read()

# Fix \` to `
content = content.replace('\\`', '`')
# Fix \$ to $
content = content.replace('\\$', '$')

with open('src/pages/teacher/MarkTest.jsx', 'w') as f:
    f.write(content)
print("done")
