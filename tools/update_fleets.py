def sync_initial_state():
    # Server index.js - modify createInitialTroops
    with open("C:/Users/byron/OneDrive/Desktop/death-earth-prototypeV1/server/index.js", "r") as f:
        content = f.read()
    
    # The function returns { counts: {}, queue: [] }
    # We want it to also include fleets: {}
    import re
    # Find the function
    new_func = """function createInitialTroops() {
  return { counts: {}, queue: [], fleets: {} };
}"""
    content = content.replace(
        """function createInitialTroops() {
  return { counts: {}, queue: [] };
}""",
        new_func
    )
    
    with open("C:/Users/byron/OneDrive/Desktop/death-earth-prototypeV1/server/index.js", "w") as f:
        f.write(content)
    print("Server index.js updated")

    # Verify
    with open("C:/Users/byron/OneDrive/Desktop/death-earth-prototypeV1/server/index.js", "r") as f:
        lines = f.readlines()
    for i, line in enumerate(lines):
        if "fleets" in line:
            print(f"  fleets found at line {i+1}: {line.rstrip()}")

sync_initial_state()
