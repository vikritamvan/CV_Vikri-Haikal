<?php
// File: index.php
?>
<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>InvestiSave - Analisis Saham</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
</head>
<body style="background-color:#f4f8fb;">

<header class="bg-success text-white text-center py-4 shadow-sm">
    <h1>InvestiSave</h1>
    <p class="lead">Menilai Risiko Kerugian Saham Bagi Investor Pemula</p>
</header>

<div class="container my-4">
    <form method="post" class="bg-white p-4 rounded shadow">
        <div class="row g-4">
            <div class="col-md-6">
                <label class="form-label">Pilih File CSV:</label>
                <select name="file" class="form-select" required>
                    <?php
                    $folder = "uploads/";
                    foreach (glob($folder . "*.csv") as $file) {
                        $filename = basename($file);
                        $selected = ($filename === ($_POST["file"] ?? '')) ? 'selected' : '';
                        echo "<option value=\"$filename\" $selected>$filename</option>";
                    }
                    ?>
                </select>

                <label class="form-label mt-3">Tampilkan Grafik?</label>
                <select name="tampilkan_grafik" class="form-select">
                    <option value="tidak" <?= ($_POST["tampilkan_grafik"] ?? '') === 'tidak' ? 'selected' : '' ?>>Tidak</option>
                    <option value="ya" <?= ($_POST["tampilkan_grafik"] ?? '') === 'ya' ? 'selected' : '' ?>>Ya</option>
                </select>
            </div>

            <div class="col-md-6">
                <label class="form-label">Nominal Investasi (Rp):</label>
                <input type="number" name="investasi" class="form-control" required value="<?= htmlspecialchars($_POST['investasi'] ?? '') ?>">

                <label class="form-label mt-3">Periode Investasi (hari):</label>
                <input type="number" name="periode" class="form-control" required value="<?= htmlspecialchars($_POST['periode'] ?? '') ?>">
            </div>
        </div>

        <div class="text-center mt-4">
            <button type="submit" class="btn btn-success btn-lg px-4">Pilih dan Hitung</button>
        </div>
    </form>

    <?php
    if ($_SERVER["REQUEST_METHOD"] === "POST" && isset($_POST["file"], $_POST["investasi"], $_POST["periode"], $_POST["tampilkan_grafik"])) {
        $selected_file = $_POST["file"];
        $file_path = $folder . $selected_file;
        $investasi = (float) $_POST["investasi"];
        $periode = (int) $_POST["periode"];
        $tampilkan_grafik = $_POST["tampilkan_grafik"];

        // Fungsi Statistik
        function mean($data) {
            return array_sum($data) / count($data);
        }

        function variance($data) {
            $n = count($data);
            if ($n < 2) return 0;
            $mean = mean($data);
            return array_sum(array_map(fn($x) => pow($x - $mean, 2), $data)) / ($n - 1); // sample variance
        }

        function standard_deviation($data) {
            return sqrt(variance($data));
        }

        function skewness($data) {
            $mean = mean($data);
            $std = standard_deviation($data);
            if ($std == 0) return 0;
            $n = count($data);
            return array_sum(array_map(fn($x) => pow(($x - $mean) / $std, 3), $data)) * ($n / (($n - 1) * ($n - 2)));
        }

        function kurtosis($data) {
            $mean = mean($data);
            $std = standard_deviation($data);
            if ($std == 0) return 0;
            $n = count($data);
            return array_sum(array_map(fn($x) => pow(($x - $mean) / $std, 4), $data)) * (($n * ($n + 1)) / (($n - 1) * ($n - 2) * ($n - 3))) - (3 * pow($n - 1, 2) / (($n - 2) * ($n - 3)));
        }

        // Baca CSV
        if (($handle = fopen($file_path, "r")) !== false) {
            $data = [];
            $labels = [];
            fgetcsv($handle); // skip header
            $i = 1;
            while (($row = fgetcsv($handle, 1000, ",")) !== false) {
                if (isset($row[0]) && is_numeric($row[0])) { // Tidak ada pembatasan nilai
                    $data[] = (float) $row[0];
                    $labels[] = $i++;
                }
            }
            fclose($handle);

            if (count($data) > 1) {
                $mean = mean($data);
                $Y1 = skewness($data);
                $Y2 = kurtosis($data);
                $Y2_prime = $Y2 - 3;

                $a_alpha = 2.32634787404084; // Z-score 99%

                $a_prime = $a_alpha 
                         + (($Y1 / 6) * ($a_alpha**2 - 1)) 
                         + (($Y2_prime / 24) * ($a_alpha**3 - 3 * $a_alpha)) 
                         - (($Y1**2 / 36) * (2 * $a_alpha**3 - 5 * $a_alpha));

                $std_dev = standard_deviation($data);
                $maks_kerugian = $investasi * ($mean - ($a_prime * $std_dev)) * sqrt($periode);

                echo "
                <div class='card mt-5 shadow-sm'>
                    <div class='card-body'>
                        <h4 class='card-title text-center'>Hasil Analisis untuk <span class='text-primary'>$selected_file</span></h4>
                        <p class='fs-5 text-center'><strong>Value at Risk (99%): Rp " . number_format(abs($maks_kerugian), 2) . "</strong></p>
                        <p class='text-center text-muted'>Jika Anda berinvestasi sebesar <strong>Rp " . number_format($investasi, 2) . "</strong> dengan jangka waktu <strong>$periode hari</strong>, maka kemungkinan maksimal kerugian sebesar <strong>Rp " . number_format(abs($maks_kerugian), 2) . "</strong> dengan tingkat kepercayaan 99%.</p>
                    </div>
                </div>
                ";

                               if ($tampilkan_grafik === "ya") {
                    echo "
                    <div class='mt-5'>
                        <h5 class='text-center mb-3'>Grafik Harga Saham</h5>
                        <canvas id='grafikSaham'></canvas>
                    </div>

                    <script>
                        const ctx = document.getElementById('grafikSaham').getContext('2d');
                        new Chart(ctx, {
                            type: 'line',
                            data: {
                                labels: " . json_encode($labels) . ",
                                datasets: [{
                                    label: 'Harga Saham',
                                    data: " . json_encode($data) . ",
                                    borderColor: 'blue',
                                    backgroundColor: 'rgba(0,123,255,0.1)',
                                    fill: true,
                                    tension: 0.3
                                }]
                            },
                            options: {
                                responsive: true,
                                plugins: {
                                    legend: { position: 'top' },
                                    tooltip: { mode: 'index', intersect: false }
                                },
                                scales: {
                                    x: { title: { display: true, text: 'Hari' }},
                                    y: { title: { display: true, text: 'Harga (Rp)' }}
                                }
                            }
                        });
                    </script>";
                }

            } else {
                echo "<div class='alert alert-warning text-center mt-4'>Data tidak cukup untuk analisis statistik.</div>";
            }
        } else {
            echo "<div class='alert alert-danger text-center mt-4'>Gagal membaca file.</div>";
        }
    }
    ?>
</div>

</body>
</html>
